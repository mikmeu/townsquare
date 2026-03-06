<template>
  <aside v-if="isVisible && prompt" class="night-wake-prompt">
    <h3>{{ t('nightWake.promptTitle') }}</h3>
    <p><strong>{{ t('nightWake.nightInfo') }}:</strong> {{ prompt.nightInfo || t('nightWake.noNightInfo') }}</p>

    <div v-if="prompt.mode === 'info' && prompt.info" class="info-card">
      <strong>{{ t('nightWake.givenInfo') }}:</strong>
      <span>{{ infoText }}</span>
      <img v-if="prompt.info.type === 'spyScreenshot' && prompt.info.imageDataUrl" :src="prompt.info.imageDataUrl"
        :alt="t('nightWake.spyUpload')" />
    </div>

    <label v-if="prompt.mode === 'action' && (prompt.actionType === 'selectPlayer' || prompt.actionType === 'selectPlayerAndCharacter')">
      {{ t('nightWake.player') }}
      <select v-model="selectionPlayerId">
        <option value="">{{ t('nightWake.selectPlayer') }}</option>
        <option v-for="entry in selectablePlayers" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
      </select>
    </label>

    <label v-if="prompt.mode === 'action' && prompt.actionType === 'selectTwoPlayers'">
      {{ t('nightWake.twoPlayers') }}
      <select v-model="selectionPlayerIds" multiple>
        <option v-for="entry in selectablePlayers" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
      </select>
    </label>

    <label v-if="prompt.mode === 'action' && (prompt.actionType === 'selectCharacter' || prompt.actionType === 'selectPlayerAndCharacter')">
      {{ t('nightWake.character') }}
      <select v-model="selectionRoleId">
        <option value="">{{ t('nightWake.selectCharacter') }}</option>
        <option v-for="entry in selectableRoles" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
      </select>
    </label>

    <button type="button" :disabled="!canSubmit" @click="submitSelection">
      {{ prompt.mode === 'action' ? t('nightWake.submit') : t('nightWake.acknowledge') }}
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import socket from "@/services/socket";
import { useGrimoireStore, useLocaleStore, useNightWakeStore, usePlayersStore, useSessionStore } from "@/stores";
import type { NightWakePrompt, NightWakeResponse } from "@/types";

const locale = useLocaleStore();
const t = locale.t;
const grimoire = useGrimoireStore();
const nightWake = useNightWakeStore();
const playersStore = usePlayersStore();
const session = useSessionStore();

const prompt = computed<NightWakePrompt | null>(() => nightWake.prompt);

const selectionPlayerId = ref("");
const selectionPlayerIds = ref<string[]>([]);
const selectionRoleId = ref("");

const selectablePlayers = computed(() => {
  return playersStore.players.filter((player) => !!player.id);
});

const selectableRoles = computed(() => {
  return Array.from(grimoire.roles.values()).map((role) => ({
    id: role.id,
    name: role.name,
  }));
});

const isVisible = computed(() => {
  return (
    session.isPlayerOrSpectator &&
    !!session.sessionId &&
    !!prompt.value &&
    prompt.value.targetPlayerId === session.playerId
  );
});

const canSubmit = computed(() => {
  if (!prompt.value) return false;
  if (prompt.value.mode === "info") return true;
  if (prompt.value.actionType === "selectPlayer") return !!selectionPlayerId.value;
  if (prompt.value.actionType === "selectTwoPlayers") return selectionPlayerIds.value.length === 2;
  if (prompt.value.actionType === "selectCharacter") return !!selectionRoleId.value;
  if (prompt.value.actionType === "selectPlayerAndCharacter") {
    return !!selectionPlayerId.value && !!selectionRoleId.value;
  }
  return false;
});

const infoText = computed(() => {
  if (!prompt.value) return "";
  const info = prompt.value.info;
  if (!info) return "";

  const playerName = (id?: string) => {
    if (!id) return "-";
    return playersStore.players.find((player) => player.id === id)?.name || "-";
  };
  const roleName = (id?: string) => {
    if (!id) return "-";
    const role = grimoire.roles.get(id) || grimoire.rolesJSONbyId.get(id);
    return role?.name || id;
  };

  switch (info.type) {
    case "yes":
    case "no":
    case "good":
    case "evil":
      return t(`nightWake.info.${info.type}`);
    case "number":
      return `${t("nightWake.info.number")}: ${info.numberValue ?? 0}`;
    case "minions":
      return `${t("nightWake.info.minions")}: ${(info.playerIds || []).map((id) => playerName(id)).join(", ")}`;
    case "demon":
      return `${t("nightWake.info.demon")}: ${playerName(info.playerId)}`;
    case "notInPlay":
      return `${t("nightWake.info.notInPlay")}: ${(info.roleIds || []).map((id) => roleName(id)).join(", ")}`;
    case "youAre":
      return `${t("nightWake.info.youAre")}: ${roleName(info.roleId)} (${t(`nightWake.info.${info.alignment || 'good'}`)})`;
    case "thisPlayerIs":
      return `${t("nightWake.info.thisPlayerIs")}: ${playerName(info.playerId)} = ${roleName(info.roleId)}`;
    case "spyScreenshot":
      return t("nightWake.info.spyScreenshot");
    default:
      return "";
  }
});

function submitSelection() {
  if (!prompt.value || !canSubmit.value) return;

  const mySeat = playersStore.players.findIndex((player) => player.id === session.playerId);
  const me = playersStore.players[mySeat];

  const response: NightWakeResponse = {
    promptId: prompt.value.id,
    promptMode: prompt.value.mode,
    fromPlayerId: session.playerId,
    fromSeat: mySeat,
    fromName: me?.name || t("nightWake.unknownPlayer"),
    ...(prompt.value.mode === "action"
      ? {
        actionType: prompt.value.actionType,
        selection: {
          ...(selectionPlayerId.value ? { playerId: selectionPlayerId.value } : {}),
          ...(selectionPlayerIds.value.length ? { playerIds: selectionPlayerIds.value.slice(0, 2) } : {}),
          ...(selectionRoleId.value ? { roleId: selectionRoleId.value } : {}),
        },
      }
      : {}),
    createdAt: Date.now(),
  };

  socket.send("direct", {
    host: ["nightWakeResponse", response],
  });

  nightWake.setPrompt(null);
  selectionPlayerId.value = "";
  selectionPlayerIds.value = [];
  selectionRoleId.value = "";
}
</script>

<style scoped lang="scss">
.night-wake-prompt {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(520px, calc(100vw - 20px));
  max-height: calc(100vh - 20px);
  overflow: auto;
  z-index: 80;
  background: rgba(0, 0, 0, 0.88);
  border: 2px solid #000;
  border-radius: 10px;
  padding: 12px;

  h3 {
    margin: 0 0 8px;
    text-align: left;
  }

  p,
  label {
    display: block;
    margin-bottom: 8px;
  }

  select,
  button {
    width: 100%;
    margin-top: 4px;
  }

  select[multiple] {
    min-height: 90px;
  }

  .info-card {
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 8px;
    padding: 8px;
    margin-bottom: 10px;

    span {
      display: block;
      margin-top: 4px;
    }

    img {
      margin-top: 8px;
      width: 100%;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }
  }
}
</style>
