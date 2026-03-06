<template>
  <button
    v-if="showInboxButton"
    type="button"
    class="whispers-inbox"
    :title="t('whispers.openInbox')"
    @click="openUnreadConversation"
  >
    <font-awesome-icon icon="hand-sparkles" class="fa fa-hand-sparkles" />
    <span class="badge">{{ whispersStore.unreadTotal }}</span>
  </button>

  <aside v-if="isVisible" class="whispers">
    <header>
      <div>
        <h3>{{ t('whispers.title') }}</h3>
        <span>{{ withLabel }}</span>
      </div>
      <button type="button" class="close" :title="t('player.cancel')" @click="whispersStore.closeConversation">
        <font-awesome-icon icon="times" class="fa fa-times" />
      </button>
    </header>

    <ul class="messages" ref="messagesList">
      <li v-for="message in conversation" :key="message.id" :class="message.direction">
        <small>{{ formatTime(message.timestamp) }}</small>
        <p>{{ message.text }}</p>
      </li>
      <li v-if="!conversation.length" class="empty">{{ t('whispers.empty') }}</li>
    </ul>

    <form @submit.prevent="sendWhisper">
      <textarea
        :value="whispersStore.draft"
        :placeholder="t('whispers.placeholder')"
        maxlength="240"
        @input="onInput"
      />
      <button type="submit" :disabled="!canSend">
        <font-awesome-icon icon="hand-sparkles" class="fa fa-hand-sparkles" />
        {{ t('whispers.send') }}
      </button>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import socket from "@/services/socket";
import { useLocaleStore, usePlayersStore, useSessionStore, useWhispersStore } from "@/stores";

const locale = useLocaleStore();
const t = locale.t;
const playersStore = usePlayersStore();
const session = useSessionStore();
const whispersStore = useWhispersStore();

const messagesList = ref<HTMLElement | null>(null);

const localSeatIndex = computed(() => {
  return playersStore.players.findIndex((player) => player.id === session.playerId);
});

const activePeerSeat = computed(() => whispersStore.activePeerSeat);

const isAdjacent = computed(() => {
  const mySeat = localSeatIndex.value;
  const peerSeat = activePeerSeat.value;
  const seatCount = playersStore.players.length;
  if (mySeat < 0 || peerSeat < 0 || seatCount < 2) return false;

  const left = (mySeat - 1 + seatCount) % seatCount;
  const right = (mySeat + 1) % seatCount;
  return peerSeat === left || peerSeat === right;
});

const isVisible = computed(() => {
  if (!session.isPlayerOrSpectator || !session.sessionId) return false;
  if (activePeerSeat.value < 0 || localSeatIndex.value < 0) return false;

  const peer = playersStore.players[activePeerSeat.value];
  if (!peer?.id) return false;
  return isAdjacent.value;
});

const peerName = computed(() => {
  const peer = playersStore.players[activePeerSeat.value];
  return peer?.name || t("whispers.neighbor");
});

const withLabel = computed(() => {
  return t("whispers.with").replace("{name}", peerName.value);
});

const conversation = computed(() => whispersStore.activeConversation);
const firstUnreadSeat = computed(() => {
  return Object.entries(whispersStore.unreadByPeerSeat)
    .find(([, count]) => Number(count) > 0)?.[0];
});

const canSend = computed(() => {
  return isVisible.value && whispersStore.draft.trim().length > 0;
});

const showInboxButton = computed(() => {
  return !isVisible.value && whispersStore.unreadTotal > 0;
});

function onInput(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  whispersStore.setDraft(input.value);
}

function sendWhisper() {
  const text = whispersStore.draft.trim();
  if (!text || activePeerSeat.value < 0) return;

  socket.send("whisper", {
    toSeat: activePeerSeat.value,
    message: text,
  });
  whispersStore.setDraft("");
}

function openUnreadConversation() {
  const unreadSeat = Number(firstUnreadSeat.value);
  if (Number.isInteger(unreadSeat) && unreadSeat >= 0) {
    whispersStore.openConversation(unreadSeat);
  }
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

watch(
  conversation,
  async () => {
    await nextTick();
    if (messagesList.value) {
      messagesList.value.scrollTop = messagesList.value.scrollHeight;
    }
  },
  { deep: true },
);

watch(isAdjacent, (adjacent) => {
  if (!adjacent && activePeerSeat.value >= 0) {
    whispersStore.closeConversation();
  }
});
</script>

<style lang="scss" scoped>
.whispers-inbox {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 46px;
  height: 46px;
  border: 2px solid #000;
  border-radius: 999px;
  color: #fff;
  background: rgba(10, 25, 45, 0.9);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  z-index: 60;

  .badge {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: #a31919;
    border: 1px solid #fff;
    font-size: 0.75em;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.whispers {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: min(360px, calc(100vw - 20px));
  background: rgba(0, 0, 0, 0.78);
  border: 2px solid #000;
  border-radius: 10px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  z-index: 60;
  backdrop-filter: blur(4px);

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);

    h3 {
      font-size: 1.1em;
      margin: 0;
      text-align: left;
    }

    span {
      font-size: 0.8em;
      opacity: 0.85;
    }

    .close {
      border: 0;
      background: transparent;
      color: #fff;
      cursor: pointer;
      padding: 2px 6px;
      font-size: 1.1em;
    }
  }

  .messages {
    max-height: 220px;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;

    li {
      padding: 6px 8px;
      border-radius: 8px;
      max-width: 85%;

      small {
        display: block;
        font-size: 0.7em;
        opacity: 0.8;
      }

      p {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }

      &.incoming {
        align-self: flex-start;
        background: rgba(40, 80, 40, 0.7);
      }

      &.outgoing {
        align-self: flex-end;
        text-align: right;
        background: rgba(35, 55, 90, 0.75);
      }

      &.empty {
        max-width: 100%;
        text-align: center;
        opacity: 0.75;
        background: transparent;
      }
    }
  }

  form {
    display: flex;
    gap: 8px;
    padding: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.2);

    textarea {
      flex: 1;
      resize: none;
      min-height: 54px;
      max-height: 120px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(0, 0, 0, 0.35);
      color: #fff;
      padding: 8px;
      font-family: inherit;
      font-size:16px;
    }

    button {
      align-self: flex-end;
      border: 1px solid rgba(255, 255, 255, 0.45);
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}
</style>
