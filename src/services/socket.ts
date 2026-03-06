import { watch } from "vue";
import {
  useGrimoireStore,
  usePlayersStore,
  useSessionStore,
  useLocaleStore,
  useNightWakeStore,
  useSoundboardStore,
  useVotingStore,
  useWhispersStore,
} from "@/stores";
import type {
  Edition,
  GamePhase,
  JukeboxSound,
  NightWakePrompt,
  NightWakeResponse,
  Nomination,
  Player,
  Role,
  SocketCommands,
  VoteHistoryEntry,
} from "@/types";

export class LiveSession {
  private readonly _wss: string;
  private _socket: WebSocket | null;
  private _isPlayerOrSpectator: boolean;
  private _gamestate: Array<{
    name: string;
    id: string;
    isDead: boolean;
    voteToken: boolean;
    pronouns: string;
    roleId?: string;
  }>;
  private readonly _pingInterval: number;
  private _pingTimer: ReturnType<typeof setTimeout> | null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null;
  private _players: Record<string, number>;
  private _pings: Record<string, number>;

  constructor() {
    this._wss =
      import.meta.env["VITE_SERVER_URL"] ||
      "wss://live.clocktower.online:8080/";
    this._socket = null;
    this._isPlayerOrSpectator = true;
    this._gamestate = [];
    this._pingInterval = 30 * 1000; // 30 seconds between pings
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._players = {}; // map of players connected to a session
    this._pings = {}; // map of player IDs to ping
  }

  initialize() {
    const sessionStore = useSessionStore();
    const localeStore = useLocaleStore();
    sessionStore.initializeFromUrl();
    if (sessionStore.sessionId) {
      this.connect(sessionStore.sessionId);
    }

    watch(
      () => sessionStore.sessionId,
      (newId) => {
        if (newId) {
          this.connect(newId);
        } else {
          this.disconnect();
        }
      },
    );

    watch(
      () => localeStore.currentLanguage,
      (newLocale) => {
        if (!this._isPlayerOrSpectator) {
          this.send("locale", newLocale);
        }
      },
    );
  }

  /**
   * Open a new session for the passed channel.
   * @param channel
   * @private
   */
  _open(channel: string) {
    const sessionStore = useSessionStore();
    this.disconnect();
    this._socket = new WebSocket(
      this._wss +
        channel +
        "/" +
        (this._isPlayerOrSpectator ? sessionStore.playerId : "host"),
    );
    this._socket.addEventListener("message", this._handleMessage.bind(this));
    this._socket.onopen = this._onOpen.bind(this);
    this._socket.onclose = (err: CloseEvent) => {
      this._socket = null;
      if (this._pingTimer) clearInterval(this._pingTimer);
      this._pingTimer = null;
      if (err.code === 1000) {
        sessionStore.setSessionId("");
        if (err.reason) alert(err.reason);
      } else {
        // connection interrupted, reconnect after 3 seconds
        sessionStore.setReconnecting(true);
        this._reconnectTimer = setTimeout(
          () => this.connect(channel),
          3 * 1000,
        );
      }
    };
  }

  send(command: SocketCommands, params: unknown) {
    if (command === "whisper" && this._isPlayerOrSpectator) {
      this._sendWhisperFromPlayer(
        params as {
          toSeat?: number;
          message?: string;
        },
      );
      return;
    }
    if (this._socket?.readyState === 1) {
      this._socket.send(JSON.stringify([command, params]));
    }
  }

  sendWhisper(toSeat: number, message: string) {
    if (!this._isPlayerOrSpectator) return;
    const text = String(message || "").trim().slice(0, 240);
    if (!text) return;
    this.send("whisper", {
      toSeat,
      message: text,
    });
  }

  _sendDirect(
    playerId: string | undefined | null,
    command: SocketCommands,
    params: unknown,
  ) {
    if (playerId) {
      this.send("direct", { [playerId]: [command, params] });
    } else {
      this.send(command, params);
    }
  }

  _onOpen() {
    const sessionStore = useSessionStore();
    if (this._isPlayerOrSpectator) {
      this._sendDirect("host", "getGamestate", sessionStore.playerId);
    } else {
      this.sendGamestate();
    }
    this._ping();
  }

  _ping() {
    const sessionStore = useSessionStore();
    this._handlePing();
    this.send("ping", [
      this._isPlayerOrSpectator
        ? sessionStore.playerId
        : Object.keys(this._players).length,
      "latency",
    ]);
    if (this._pingTimer) clearTimeout(this._pingTimer);
    this._pingTimer = setTimeout(this._ping.bind(this), this._pingInterval);
  }

  async _handleMessage({ data }: MessageEvent) {
    const grimoire = useGrimoireStore();
    const localeStore = useLocaleStore();
    const playersStore = usePlayersStore();
    const soundboardStore = useSoundboardStore();
    const votingStore = useVotingStore();

    let command: string = "",
      params: unknown;
    try {
      [command, params] = JSON.parse(data);
    } catch (err) {
      console.log("unsupported socket message", err, data);
      return;
    }
    switch (command) {
      case "getGamestate":
        this.sendGamestate(params as string | undefined, false);
        break;
      case "edition":
        this._updateEdition(
          params as {
            edition: Edition;
            roles?: Array<Role>;
          },
        );
        break;
      case "fabled":
        this._updateFabled(
          params as Array<Role | { id: string; isCustom?: boolean }>,
        );
        break;
      case "gs":
        await this._updateGamestate(params as Record<string, unknown>);
        break;
      case "player":
        this._updatePlayer(
          params as {
            index: number;
            property: keyof Player;
            value: unknown;
          },
        );
        break;
      case "claim":
        this._updateSeat(params as [number, string]);
        break;
      case "ping":
        this._handlePing(
          params as [(number | undefined)?, unknown?] | undefined,
        );
        break;
      case "nomination":
        this._handleNominationMsg(params as Nomination | null);
        break;
      case "swap":
        if (!this._isPlayerOrSpectator) return;
        playersStore.swap(params as [number, number]);
        break;
      case "move":
        if (!this._isPlayerOrSpectator) return;
        playersStore.move(params as [number, number]);
        break;
      case "remove":
        if (!this._isPlayerOrSpectator) return;
        playersStore.remove(params as number);
        break;
      case "marked":
        if (!this._isPlayerOrSpectator) return;
        votingStore.setMarkedPlayer(params as number);
        break;
      case "gamePhase":
        if (!this._isPlayerOrSpectator) return;
        grimoire.setGamePhase(params as GamePhase);
        break;
      case "dayCount":
        if (!this._isPlayerOrSpectator) return;
        grimoire.setDayCount(params as number);
        break;
      case "allowSelfNaming":
        if (!this._isPlayerOrSpectator) return;
        grimoire.setAllowSelfNaming(!!params);
        break;
      case "isSecretVoteMode":
      case "isSecretVote":
        if (!this._isPlayerOrSpectator) return;
        grimoire.setSecretVote(params as boolean);
        break;
      case "playSound":
        if (!this._isPlayerOrSpectator) return;
        soundboardStore.playSound(params as { sound: JukeboxSound });
        break;
      case "setTimer":
        if (!this._isPlayerOrSpectator) return;
        grimoire.setTimer(params as { name?: string; duration?: number });
        break;
      case "isVoteHistoryAllowed":
        if (!this._isPlayerOrSpectator) return;
        grimoire.setVoteHistoryAllowed(params as boolean);
        votingStore.clearVoteHistory();
        break;
      case "votingSpeed":
        if (!this._isPlayerOrSpectator) return;
        votingStore.setVotingSpeed(params as number);
        break;
      case "clearRoles":
        playersStore.clearRoles(true);
        break;
      case "clearVoteHistory":
        votingStore.clearVoteHistory();
        break;
      case "isVoteInProgress":
        if (!this._isPlayerOrSpectator) return;
        votingStore.setVoteInProgress(params as boolean);
        break;
      case "vote":
        this._handleVote(params as [number, boolean, boolean]);
        break;
      case "lock":
        this._handleLock(params as [number, boolean]);
        break;
      case "bye":
        this._handleBye(params as string);
        break;
      case "whisper":
        this._handleWhisper(
          params as {
            fromPlayerId?: string;
            fromSeat?: number;
            toSeat?: number;
            message?: string;
            fromName?: string;
            toName?: string;
            direction?: "incoming" | "outgoing";
          },
        );
        break;
      case "nightWake":
        this._handleNightWake(params as NightWakePrompt);
        break;
      case "nightWakeResponse":
        this._handleNightWakeResponse(params as NightWakeResponse);
        break;
      case "pronouns":
        this._updatePlayerPronouns(params as [number, string]);
        break;
      case "name":
        this._updatePlayerName(params as [number, string]);
        break;
      case "locale":
        localeStore.forceLocale(params as string);
        break;
      case "voteHistory":
        votingStore.setVoteHistory(params as VoteHistoryEntry[]);
        break;
    }
  }

  connect(channel: string) {
    const nightWakeStore = useNightWakeStore();
    const sessionStore = useSessionStore();
    const whispersStore = useWhispersStore();
    if (!sessionStore.playerId) {
      sessionStore.setPlayerId(Math.random().toString(36).substring(2));
    }
    whispersStore.clear();
    nightWakeStore.clearAll();
    this._pings = {};
    sessionStore.setPlayerCount(0);
    sessionStore.setPing(0);
    this._isPlayerOrSpectator = sessionStore.isPlayerOrSpectator;
    this._open(channel);
  }

  disconnect() {
    const nightWakeStore = useNightWakeStore();
    const sessionStore = useSessionStore();
    const whispersStore = useWhispersStore();
    this._pings = {};
    whispersStore.clear();
    nightWakeStore.clearAll();
    sessionStore.setPlayerCount(0);
    sessionStore.setPing(0);
    sessionStore.setReconnecting(false);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._socket) {
      if (this._isPlayerOrSpectator) {
        this._sendDirect("host", "bye", sessionStore.playerId);
      }
      this._socket.close(1000);
      this._socket = null;
    }
    const localeStore = useLocaleStore();
    localeStore.revertLocale();
  }

  requestGamestate() {
    const sessionStore = useSessionStore();
    if (this._isPlayerOrSpectator && sessionStore.sessionId) {
      this._sendDirect("host", "getGamestate", sessionStore.playerId);
    }
  }

  sendGamestate(playerId = "", isLightweight = false) {
    if (this._isPlayerOrSpectator) return;
    const grimoireStore = useGrimoireStore();
    const playersStore = usePlayersStore();
    const votingStore = useVotingStore();
    const localeStore = useLocaleStore();

    this._gamestate = playersStore.players.map((player: Player) => ({
      name: player.name,
      id: player.id,
      isDead: player.isDead,
      voteToken: player.voteToken,
      pronouns: player.pronouns,
      ...(player.role?.team === "traveler" ? { roleId: player.role.id } : {}),
    }));
    if (isLightweight) {
      this._sendDirect(playerId, "gs", {
        gamestate: this._gamestate,
        isLightweight,
      });
    } else {
      this.sendEdition(playerId);
      const voteHistory = [...votingStore.voteHistory];

      if (grimoireStore.isVoteHistoryAllowed) {
        // Sanitize anonymous votes
        voteHistory.forEach((entry, i) => {
          if (entry.anonymous) {
            voteHistory[i] = { ...entry, votes: [] };
          }
        });
      } else {
        // Clear history if not allowed
        voteHistory.length = 0;
      }

      this._sendDirect(playerId, "gs", {
        gamestate: this._gamestate,
        gamePhase: grimoireStore.gamePhase,
        dayCount: grimoireStore.dayCount,
        timer: grimoireStore.timer,
        allowSelfNaming: grimoireStore.allowSelfNaming,
        isVoteHistoryAllowed: grimoireStore.isVoteHistoryAllowed,
        isSecretVoteMode: grimoireStore.isSecretVote,
        nomination: votingStore.nomination,
        votingSpeed: votingStore.votingSpeed,
        lockedVote: votingStore.lockedVote,
        isVoteInProgress: votingStore.isVoteInProgress,
        markedPlayer: votingStore.markedPlayer,
        fabled: playersStore.fabled.map((f: Role) =>
          f.isCustom ? f : { id: f.id },
        ),
        ...(votingStore.nomination ? { votes: votingStore.votes } : {}),
        voteHistory,
        locale: localeStore.currentLanguage,
      });
    }
  }

  async _updateGamestate(data: Record<string, unknown>) {
    if (!this._isPlayerOrSpectator) return;
    const grimoireStore = useGrimoireStore();
    const playersStore = usePlayersStore();
    const votingStore = useVotingStore();
    const localeStore = useLocaleStore();

    const {
      gamestate,
      isLightweight,
      gamePhase,
      dayCount,
      allowSelfNaming,
      isVoteHistoryAllowed,
      isSecretVoteMode,
      timer,
      nomination,
      votingSpeed,
      votes,
      voteHistory,
      lockedVote,
      isVoteInProgress,
      markedPlayer,
      fabled,
      locale,
    } = data as {
      gamestate: Array<{
        name: string;
        id: string;
        isDead: boolean;
        voteToken: boolean;
        pronouns: string;
        roleId?: string;
      }>;
      isLightweight?: boolean;
      gamePhase?: GamePhase;
      dayCount?: number;
      allowSelfNaming?: boolean;
      isVoteHistoryAllowed?: boolean;
      isSecretVoteMode?: boolean;
      timer?: { name?: string; duration?: number };
      nomination: Nomination | null;
      votingSpeed?: number;
      votes?: boolean[];
      voteHistory?: VoteHistoryEntry[];
      lockedVote?: number;
      isVoteInProgress?: boolean;
      markedPlayer?: number;
      fabled: Array<{ id: string; isCustom?: boolean }>;
      locale: string;
    };

    await localeStore.forceLocale(locale);

    const players = playersStore.players;
    // adjust number of players
    if (players.length < gamestate.length) {
      for (let x = players.length; x < gamestate.length; x++) {
        playersStore.add(String(gamestate[x]?.name ?? ""));
      }
    } else if (players.length > gamestate.length) {
      for (let x = players.length; x > gamestate.length; x--) {
        playersStore.remove(x - 1);
      }
    }
    // update status for each player
    gamestate.forEach((st, x) => {
      // Get fresh reference to players array after potential additions/removals
      const currentPlayers = playersStore.players;
      const player = currentPlayers[x];
      const { roleId } = st;
      (["name", "id", "isDead", "voteToken", "pronouns"] as const).forEach(
        (property) => {
          const value = st[property];
          if (
            player &&
            (player as unknown as Record<string, unknown>)[property] !== value
          ) {
            playersStore.update({ player, property, value });
          }
        },
      );
      if (player && roleId && player.role.id !== roleId) {
        const role =
          grimoireStore.roles.get(roleId) ||
          grimoireStore.rolesJSONbyId.get(roleId);
        if (role)
          playersStore.update({
            player,
            property: "role",
            value: role,
          });
      } else if (player && !roleId && player.role.team === "traveler") {
        playersStore.update({
          player,
          property: "role",
          value: {},
        });
      }
    });
    if (!isLightweight) {
      grimoireStore.setTimer(timer || {});
      grimoireStore.setAllowSelfNaming(!!allowSelfNaming);
      grimoireStore.setVoteHistoryAllowed(!!isVoteHistoryAllowed);
      grimoireStore.setSecretVote(!!isSecretVoteMode);
      votingStore.updateNomination({
        nomination,
        votes: votes || [],
        votingSpeed: votingSpeed || 0,
        lockedVote: lockedVote || -1,
        isVoteInProgress: isVoteInProgress || false,
      });
      votingStore.setVoteHistory(voteHistory || []);
      votingStore.setMarkedPlayer(markedPlayer || -1);
      grimoireStore.setGamePhase(gamePhase || "pregame");
      grimoireStore.setDayCount(dayCount || 0);
      playersStore.setFabled({
        fabled: fabled.map((f) => grimoireStore.fabled.get(f.id) || f),
      });
    }
  }

  sendEdition(playerId = "") {
    if (this._isPlayerOrSpectator) return;
    const grimoireStore = useGrimoireStore();
    const { edition } = grimoireStore;
    let roles;
    if (edition && !edition.isOfficial) {
      roles = Array.from<Role>(grimoireStore.roles.values()).map(
        (role: Role) => (role.isCustom ? role : { id: role.id }),
      );
    }
    this._sendDirect(playerId, "edition", {
      edition,
      ...(roles ? { roles } : {}),
    });
  }

  _updateEdition({
    edition,
    roles,
  }: {
    edition: Edition;
    roles?: Array<Role>;
  }) {
    if (!this._isPlayerOrSpectator) return;
    const grimoireStore = useGrimoireStore();
    grimoireStore.setEdition(edition);
    if (roles) {
      grimoireStore.setCustomRoles(roles);
      if (grimoireStore.roles.size !== roles.length) {
        const missing: string[] = [];
        roles.forEach((r) => {
          const id =
            r.id || ((r as unknown as Record<string, unknown>)["id"] as string);
          if (!grimoireStore.roles.get(id)) missing.push(id);
        });
        alert(
          `This session contains custom characters that can't be found. ` +
            `Please load them before joining! ` +
            `Missing roles: ${missing.join(", ")}`,
        );
        this.disconnect();
      }
    }
  }

  _updateFabled(fabled: Array<Role | { id: string; isCustom?: boolean }>) {
    if (!this._isPlayerOrSpectator) return;
    const playersStore = usePlayersStore();
    const grimoireStore = useGrimoireStore();
    playersStore.setFabled({
      fabled: fabled.map((f) => grimoireStore.fabled.get(f.id) || f),
    });
  }

  _updatePlayer({
    index,
    property,
    value,
  }: {
    index: number;
    property: keyof Player | "role";
    value: unknown;
  }) {
    if (!this._isPlayerOrSpectator) return;
    const playersStore = usePlayersStore();
    const player = playersStore.players[index];
    if (!player) return;
    playersStore.update({ player, property, value, isFromSocket: true });
  }

  _updatePlayerPronouns([index, value]: [number, string]) {
    const playersStore = usePlayersStore();
    const player = playersStore.players[index];
    if (!player) return;

    playersStore.update({
      player,
      property: "pronouns",
      value,
      isFromSocket: true,
    });
  }

  _updatePlayerName([index, value]: [number, string]) {
    const playersStore = usePlayersStore();
    const player = playersStore.players[index];
    if (!player) return;

    playersStore.update({
      player,
      property: "name",
      value,
      isFromSocket: true,
    });
  }

  _cleanupDisconnectedPlayers(now: number) {
    const playersStore = usePlayersStore();

    // remove players that haven't sent a ping in 2.5 times the timespan
    for (let player in this._players) {
      if (
        this._players[player] &&
        now - this._players[player] > this._pingInterval * 2.5
      ) {
        delete this._players[player];
        delete this._pings[player];
      }
    }
    // remove claimed seats from players that are no longer connected
    playersStore.players.forEach((player: Player) => {
      if (player.id && !this._players[player.id]) {
        playersStore.update({
          player,
          property: "id",
          value: "",
        });
      }
    });
  }

  _handlePing([playerIdOrCount = 0, latency]: [
    (number | undefined)?,
    unknown?,
  ] = []) {
    const sessionStore = useSessionStore();

    const now = Date.now();
    if (!this._isPlayerOrSpectator) {
      this._cleanupDisconnectedPlayers(now);
      // store new player data
      if (playerIdOrCount) {
        this._players[playerIdOrCount] = now;
        const ping = Number.parseInt(latency as string, 10);
        if (ping && ping > 0 && ping < 30 * 1000) {
          // ping to Players
          this._pings[playerIdOrCount] = ping;
          const pings = Object.values(this._pings);
          sessionStore.setPing(
            Math.round(pings.reduce((a, b) => a + b, 0) / pings.length),
          );
        }
      }
    } else if (latency) {
      // ping to ST
      sessionStore.setPing(Number.parseInt(latency as string, 10));
    }
    // update player count
    if (!this._isPlayerOrSpectator || playerIdOrCount) {
      const playerCount = this._isPlayerOrSpectator
        ? playerIdOrCount
        : Object.keys(this._players).length;
      sessionStore.setPlayerCount(playerCount);
    }
  }

  _handleBye(playerId: string) {
    const playersStore = usePlayersStore();
    if (this._isPlayerOrSpectator) return;
    delete this._players[playerId];
    delete this._pings[playerId];
    const player = playersStore.players.find((p: Player) => p.id === playerId);
    if (player) {
      playersStore.update({
        player,
        property: "id",
        value: "",
      });
    }
  }

  _isAdjacentSeats(fromSeat: number, toSeat: number, seatCount: number) {
    if (seatCount < 2) return false;
    const left = (fromSeat - 1 + seatCount) % seatCount;
    const right = (fromSeat + 1) % seatCount;
    return toSeat === left || toSeat === right;
  }

  _sendWhisperFromPlayer(params: { toSeat?: number; message?: string }) {
    const playersStore = usePlayersStore();
    const sessionStore = useSessionStore();
    const whispersStore = useWhispersStore();

    const toSeat = Number(params.toSeat);
    const message = String(params.message || "").trim().slice(0, 240);
    const players = playersStore.players;
    const fromSeat = players.findIndex((player) => player.id === sessionStore.playerId);

    if (!message || !Number.isInteger(toSeat) || fromSeat < 0 || toSeat < 0) return;
    if (toSeat >= players.length || toSeat === fromSeat) return;
    if (!this._isAdjacentSeats(fromSeat, toSeat, players.length)) return;

    const fromPlayer = players[fromSeat];
    const toPlayer = players[toSeat];
    if (!fromPlayer?.id || !toPlayer?.id) return;

    this.send("direct", {
      [toPlayer.id]: ["whisper", {
        fromSeat,
        toSeat,
        fromPlayerId: fromPlayer.id,
        fromName: fromPlayer.name,
        message,
        direction: "incoming",
      }],
    });

    whispersStore.addOutgoingMessage({
      toSeat,
      toName: toPlayer.name,
      text: message,
    });
  }

  _handleWhisper(params: {
    fromPlayerId?: string;
    fromSeat?: number;
    toSeat?: number;
    message?: string;
    fromName?: string;
    toName?: string;
    direction?: "incoming" | "outgoing";
  }) {
    const playersStore = usePlayersStore();
    const whispersStore = useWhispersStore();
    const message = String(params.message || "").trim().slice(0, 240);
    if (!message) return;

    if (this._isPlayerOrSpectator) {
      const sessionStore = useSessionStore();
      const peerSeat =
        params.direction === "outgoing"
          ? Number(params.toSeat)
          : Number(params.fromSeat);
      if (!Number.isInteger(peerSeat) || peerSeat < 0) return;

      const mySeat = playersStore.players.findIndex(
        (player) => player.id === sessionStore.playerId,
      );
      if (!this._isAdjacentSeats(mySeat, peerSeat, playersStore.players.length)) return;

      if (params.fromPlayerId && params.direction === "incoming") {
        const claimedBySender = playersStore.players[peerSeat]?.id;
        if (claimedBySender !== params.fromPlayerId) return;
      }

      if (params.direction === "outgoing") {
        whispersStore.addOutgoingMessage({
          toSeat: peerSeat,
          toName: params.toName || "",
          text: message,
        });
      } else {
        whispersStore.addIncomingMessage({
          fromSeat: peerSeat,
          fromName: params.fromName || "",
          text: message,
        });
      }
      return;
    }

    const fromPlayerId = String(params.fromPlayerId || "");
    const toSeat = Number(params.toSeat);
    if (!fromPlayerId || !Number.isInteger(toSeat)) return;

    const players = playersStore.players;
    const seatCount = players.length;
    const fromSeat = players.findIndex((player) => player.id === fromPlayerId);
    if (fromSeat < 0 || toSeat < 0 || toSeat >= seatCount || toSeat === fromSeat) {
      return;
    }
    if (!this._isAdjacentSeats(fromSeat, toSeat, seatCount)) return;

    const fromPlayer = players[fromSeat];
    const toPlayer = players[toSeat];
    if (!fromPlayer?.id || !toPlayer?.id) return;

    this.send("direct", {
      [toPlayer.id]: ["whisper", {
        fromSeat,
        toSeat,
        fromName: fromPlayer.name,
        message,
        direction: "incoming",
      }],
      [fromPlayer.id]: ["whisper", {
        fromSeat,
        toSeat,
        toName: toPlayer.name,
        message,
        direction: "outgoing",
      }],
    });
  }

  _handleNightWake(prompt: NightWakePrompt) {
    if (!this._isPlayerOrSpectator) return;
    const nightWakeStore = useNightWakeStore();
    const sessionStore = useSessionStore();
    if (prompt.targetPlayerId !== sessionStore.playerId) return;
    nightWakeStore.setPrompt(prompt);
  }

  _handleNightWakeResponse(response: NightWakeResponse) {
    if (this._isPlayerOrSpectator) return;
    const nightWakeStore = useNightWakeStore();
    nightWakeStore.addResponse(response);
  }

  _updateSeat([seatIndex, playerId]: [number, string]) {
    if (this._isPlayerOrSpectator) return;
    const playersStore = usePlayersStore();
    const player = playersStore.players[seatIndex];
    // check if player is already seated
    const oldSeat = playersStore.players.findIndex(
      (p: Player) => p.id === playerId,
    );
    console.log("switched from seat ", oldSeat, "to seat", seatIndex);
    if (oldSeat > -1 && oldSeat !== seatIndex) {
      const oldPlayer = playersStore.players[oldSeat];
      if (oldPlayer) {
        playersStore.update({
          player: oldPlayer,
          property: "id",
          value: "",
        });
      }
    }
    if (!player) return;
    playersStore.update({
      player,
      property: "id",
      value: playerId,
    });
  }

  _handleVote([index, vote, fromST]: [number, boolean, boolean]) {
    const votingStore = useVotingStore();
    const playersStore = usePlayersStore();
    const playerCount = playersStore.players.length;
    const indexAdjusted =
      (index -
        1 +
        playerCount -
        (typeof votingStore.nomination?.nominee == "number"
          ? votingStore.nomination.nominee
          : (votingStore.nomination?.nominator as number) || 0)) %
      playerCount;
    if (fromST || indexAdjusted >= votingStore.lockedVote - 1) {
      votingStore.handleVote([index, !!vote]);
    }
  }

  _handleLock([seatIndex, isForced]: [number, boolean]) {
    const playersStore = usePlayersStore();
    const votingStore = useVotingStore();
    if (!this._isPlayerOrSpectator) return;
    votingStore.lockVote(seatIndex);
    if (seatIndex > 1) {
      const { lockedVote, nomination, votes } = votingStore;
      const index =
        ((typeof nomination?.nominee == "number"
          ? nomination.nominee
          : (nomination?.nominator as number) || 0) +
          lockedVote -
          1) %
        playersStore.players.length;
      if (votes[index] !== !!isForced) {
        votingStore.vote([index, !!isForced]);
      }
    }
  }

  _handleNominationMsg(params: Nomination | null) {
    if (!this._isPlayerOrSpectator) return;
    const votingStore = useVotingStore();

    votingStore.updateNomination({
      nomination: params,
    });
  }
}

export default new LiveSession();
