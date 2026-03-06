<template>
  <aside v-if="isVisible" class="night-wake-storyteller">
    <h3>{{ t('nightWake.title') }}</h3>

    <label>
      {{ t('nightWake.target') }}
      <select v-model.number="targetSeat">
        <option :value="-1">{{ t('nightWake.selectTarget') }}</option>
        <option v-for="entry in seatedPlayers" :key="entry.id" :value="entry.seat">
          {{ entry.name }} ({{ entry.roleName }})
        </option>
      </select>
    </label>

    <label v-if="targetPlayer" class="night-info">
      {{ t('nightWake.nightInfo') }}
      <textarea v-model="nightInfoText" rows="3" />
    </label>

    <label>
      {{ t('nightWake.mode') }}
      <select v-model="promptMode">
        <option value="action">{{ t('nightWake.modes.action') }}</option>
        <option value="info">{{ t('nightWake.modes.info') }}</option>
      </select>
    </label>

    <label v-if="promptMode === 'action'">
      {{ t('nightWake.action') }}
      <select v-model="actionType">
        <option value="selectPlayer">{{ t('nightWake.actions.selectPlayer') }}</option>
        <option value="selectTwoPlayers">{{ t('nightWake.actions.selectTwoPlayers') }}</option>
        <option value="selectCharacter">{{ t('nightWake.actions.selectCharacter') }}</option>
        <option value="selectPlayerAndCharacter">{{ t('nightWake.actions.selectPlayerAndCharacter') }}</option>
      </select>
    </label>

    <label v-if="promptMode === 'info'">
      {{ t('nightWake.infoType') }}
      <select v-model="infoType">
        <option value="yes">{{ t('nightWake.info.yes') }}</option>
        <option value="no">{{ t('nightWake.info.no') }}</option>
        <option value="good">{{ t('nightWake.info.good') }}</option>
        <option value="evil">{{ t('nightWake.info.evil') }}</option>
        <option value="number">{{ t('nightWake.info.number') }}</option>
        <option value="minions">{{ t('nightWake.info.minions') }}</option>
        <option value="demon">{{ t('nightWake.info.demon') }}</option>
        <option value="notInPlay">{{ t('nightWake.info.notInPlay') }}</option>
        <option value="youAre">{{ t('nightWake.info.youAre') }}</option>
        <option value="thisPlayerIs">{{ t('nightWake.info.thisPlayerIs') }}</option>
        <option value="spyScreenshot">{{ t('nightWake.info.spyScreenshot') }}</option>
      </select>
    </label>

    <label v-if="infoType === 'number'">
      {{ t('nightWake.number') }}
      <select v-model.number="numberValue">
        <option v-for="n in [0,1,2,3,4,5]" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>

    <label v-if="infoType === 'demon'">
      {{ t('nightWake.demon') }}
      <select v-model="singlePlayerId">
        <option value="">{{ t('nightWake.selectPlayer') }}</option>
        <option v-for="entry in demonPlayers" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
      </select>
    </label>

    <label v-if="infoType === 'thisPlayerIs'">
      {{ t('nightWake.player') }}
      <select v-model="singlePlayerId">
        <option value="">{{ t('nightWake.selectPlayer') }}</option>
        <option v-for="entry in seatedPlayers" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
      </select>
    </label>

    <label v-if="infoType === 'minions' || infoType === 'notInPlay'">
      {{ infoType === 'minions' ? t('nightWake.minions') : t('nightWake.roles') }}
      <select v-model="multiValues" multiple>
        <option
          v-for="entry in infoType === 'minions' ? minionPlayers : availableRoles"
          :key="entry.id"
          :value="entry.id"
        >
          {{ entry.name }}
        </option>
      </select>
    </label>

    <label v-if="infoType === 'youAre' || infoType === 'thisPlayerIs'">
      {{ t('nightWake.character') }}
      <select v-model="singleRoleId">
        <option value="">{{ t('nightWake.selectCharacter') }}</option>
        <option v-for="role in availableRoles" :key="role.id" :value="role.id">{{ role.name }}</option>
      </select>
    </label>

    <label v-if="infoType === 'youAre'">
      {{ t('nightWake.alignment') }}
      <select v-model="alignment">
        <option value="good">{{ t('nightWake.info.good') }}</option>
        <option value="evil">{{ t('nightWake.info.evil') }}</option>
      </select>
    </label>

    <label v-if="infoType === 'spyScreenshot'">
      {{ t('nightWake.spyUpload') }}
      <input type="file" accept="image/*" @change="onSpyUpload" />
    </label>

    <button type="button" :disabled="!canSend" @click="wakePlayer">
      {{ promptMode === 'action' ? t('nightWake.wake') : t('nightWake.sendInfo') }}
    </button>

    <div v-if="nightWake.responses.length" class="responses">
      <h4>{{ t('nightWake.responses') }}</h4>
      <ul>
        <li v-for="response in nightWake.responses" :key="response.createdAt + response.promptId">
          {{ formatResponse(response) }}
          <button type="button" class="followup" @click="followUpInfo(response)">
            {{ t('nightWake.sendInfoToPlayer') }}
          </button>
        </li>
      </ul>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import socket from "@/services/socket";
import {
  useGrimoireStore,
  useLocaleStore,
  useNightWakeStore,
  usePlayersStore,
  useSessionStore,
  useUserPreferencesStore,
} from "@/stores";
import type { NightWakeActionType, NightWakeInfo, NightWakeInfoType, NightWakeResponse } from "@/types";

const locale = useLocaleStore();
const t = locale.t;
const grimoire = useGrimoireStore();
const nightWake = useNightWakeStore();
const playersStore = usePlayersStore();
const session = useSessionStore();
const userPreferences = useUserPreferencesStore();

const promptMode = ref<"action" | "info">("action");
const actionType = ref<NightWakeActionType>("selectPlayer");
const infoType = ref<NightWakeInfoType>("yes");
const targetSeat = ref(-1);
const numberValue = ref(0);
const singlePlayerId = ref("");
const singleRoleId = ref("");
const alignment = ref<"good" | "evil">("good");
const multiValues = ref<string[]>([]);
const spyImageDataUrl = ref("");
const nightInfoText = ref("");

const isVisible = computed(() => {
  return (
    !session.isPlayerOrSpectator &&
    !!session.sessionId &&
    !userPreferences.isMenuOpen &&
    !grimoire.modal &&
    (grimoire.gamePhase === "firstNight" || grimoire.gamePhase === "otherNight")
  );
});

const seatedPlayers = computed(() => {
  return playersStore.players
    .map((player, seat) => ({
      ...player,
      seat,
      roleName: player.role?.name || "-",
    }))
    .filter((player) => !!player.id);
});

const minionPlayers = computed(() => {
  return seatedPlayers.value.filter((player) => player.role?.team === "minion");
});

const demonPlayers = computed(() => {
  return seatedPlayers.value.filter((player) => player.role?.team === "demon");
});

const availableRoles = computed(() => {
  return Array.from(grimoire.roles.values()).map((role) => ({
    id: role.id,
    name: role.name,
  }));
});

const targetPlayer = computed(() => {
  return playersStore.players[targetSeat.value];
});

const targetNightInfo = computed(() => {
  const player = targetPlayer.value;
  if (!player?.role) return "";
  return grimoire.gamePhase === "firstNight"
    ? player.role.firstNightReminder || ""
    : player.role.otherNightReminder || "";
});

const canSend = computed(() => {
  const player = targetPlayer.value;
  if (!player?.id || targetSeat.value < 0) return false;

  if (promptMode.value === "action") return true;

  if (infoType.value === "demon" || infoType.value === "thisPlayerIs") {
    if (!singlePlayerId.value) return false;
  }
  if (infoType.value === "youAre" || infoType.value === "thisPlayerIs") {
    if (!singleRoleId.value) return false;
  }
  if (infoType.value === "spyScreenshot" && !spyImageDataUrl.value) return false;
  if (infoType.value === "minions" && !multiValues.value.length) return false;
  if (infoType.value === "notInPlay" && (multiValues.value.length < 1 || multiValues.value.length > 3)) return false;

  return true;
});

function buildInfo(): NightWakeInfo {
  const info: NightWakeInfo = { type: infoType.value };
  if (infoType.value === "number") {
    info.numberValue = numberValue.value;
  }
  if (infoType.value === "minions") {
    info.playerIds = [...multiValues.value];
  }
  if (infoType.value === "demon") {
    info.playerId = singlePlayerId.value;
  }
  if (infoType.value === "notInPlay") {
    info.roleIds = [...multiValues.value].slice(0, 3);
  }
  if (infoType.value === "youAre") {
    info.roleId = singleRoleId.value;
    info.alignment = alignment.value;
  }
  if (infoType.value === "thisPlayerIs") {
    info.playerId = singlePlayerId.value;
    info.roleId = singleRoleId.value;
  }
  if (infoType.value === "spyScreenshot") {
    info.imageDataUrl = spyImageDataUrl.value;
  }
  return info;
}

function wakePlayer() {
  const player = targetPlayer.value;
  if (!player?.id || !canSend.value) return;

  const promptId = `wake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prompt = {
    id: promptId,
    targetPlayerId: player.id,
    targetSeat: targetSeat.value,
    targetName: player.name,
    roleId: player.role?.id,
    roleName: player.role?.name,
    nightInfo: nightInfoText.value.trim() || targetNightInfo.value,
    mode: promptMode.value,
    ...(promptMode.value === "action"
      ? { actionType: actionType.value }
      : { info: buildInfo() }),
    createdAt: Date.now(),
  };

  socket.send("direct", {
    [player.id]: ["nightWake", prompt],
  });
}

function onSpyUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    spyImageDataUrl.value = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

function playerNameById(playerId?: string) {
  if (!playerId) return "-";
  const player = playersStore.players.find((p) => p.id === playerId);
  return player?.name || "-";
}

function roleNameById(roleId?: string) {
  if (!roleId) return "-";
  const role = grimoire.roles.get(roleId) || grimoire.rolesJSONbyId.get(roleId);
  return role?.name || roleId;
}

function formatSelection(response: NightWakeResponse) {
  const selection = response.selection;
  if (!selection) return "-";
  if (selection.playerIds?.length) {
    return selection.playerIds.map((id) => playerNameById(id)).join(", ");
  }
  if (selection.playerId && selection.roleId) {
    return `${playerNameById(selection.playerId)} + ${roleNameById(selection.roleId)}`;
  }
  if (selection.playerId) {
    return playerNameById(selection.playerId);
  }
  if (selection.roleId) {
    return roleNameById(selection.roleId);
  }
  return "-";
}

function formatResponse(response: NightWakeResponse) {
  if (response.promptMode === "info") {
    return `${response.fromName}: ${t('nightWake.acknowledge')}`;
  }
  return `${response.fromName}: ${formatSelection(response)}`;
}

function followUpInfo(response: NightWakeResponse) {
  targetSeat.value = response.fromSeat;
  promptMode.value = "info";
}

watch(targetSeat, () => {
  nightInfoText.value = targetNightInfo.value;
});

watch(infoType, (nextType) => {
  if (nextType !== "notInPlay") return;
  const bluffRoleIds = playersStore.bluffs
    .map((role) => role?.id)
    .filter((id): id is string => !!id)
    .slice(0, 3);
  multiValues.value = bluffRoleIds;
});
</script>

<style scoped lang="scss">
.night-wake-storyteller {
  position: absolute;
  bottom: 10px;
  left: 10px;
  width: min(420px, calc(100vw - 20px));
  max-height: calc(100vh - 20px);
  overflow: auto;
  z-index: 70;
  background: rgba(0, 0, 0, 0.82);
  border: 2px solid #000;
  border-radius: 10px;
  padding: 10px;

  h3,
  h4 {
    margin: 0 0 8px;
    text-align: left;
  }

  label,
  p {
    display: block;
    margin-bottom: 8px;
    font-size: 0.92em;
  }

  select,
  textarea,
  input,
  button {
    width: 100%;
    margin-top: 4px;
  }

  textarea {
    resize: vertical;
    min-height: 4.5em;
  }

  select[multiple] {
    min-height: 88px;
  }

  .night-info {
    font-size: 0.86em;
    opacity: 0.95;
  }

  .responses ul {
    padding: 0;
    margin: 0;
  }

  .responses li {
    margin-bottom: 4px;
    font-size: 0.84em;

    .followup {
      width: auto;
      margin-left: 8px;
      font-size: 0.92em;
      padding: 2px 8px;
    }
  }
}
</style>
