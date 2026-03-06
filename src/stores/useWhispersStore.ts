import { defineStore } from "pinia";

interface WhisperMessage {
  id: number;
  peerSeat: number;
  text: string;
  fromName: string;
  direction: "incoming" | "outgoing";
  timestamp: number;
}

interface WhispersState {
  activePeerSeat: number;
  draft: string;
  messages: WhisperMessage[];
  unreadByPeerSeat: Record<number, number>;
  lastMessageId: number;
}

export const useWhispersStore = defineStore("whispers", {
  state: (): WhispersState => ({
    activePeerSeat: -1,
    draft: "",
    messages: [],
    unreadByPeerSeat: {},
    lastMessageId: 0,
  }),

  getters: {
    unreadTotal(state): number {
      return Object.values(state.unreadByPeerSeat).reduce(
        (sum, unread) => sum + unread,
        0,
      );
    },

    activeConversation(state): WhisperMessage[] {
      if (state.activePeerSeat < 0) return [];
      return state.messages.filter((message) => message.peerSeat === state.activePeerSeat);
    },
  },

  actions: {
    openConversation(peerSeat: number) {
      this.activePeerSeat = peerSeat;
      this.unreadByPeerSeat[peerSeat] = 0;
    },

    closeConversation() {
      this.activePeerSeat = -1;
      this.draft = "";
    },

    setDraft(text: string) {
      this.draft = text;
    },

    addIncomingMessage({
      fromSeat,
      fromName,
      text,
    }: {
      fromSeat: number;
      fromName: string;
      text: string;
    }) {
      this.lastMessageId += 1;
      this.messages.push({
        id: this.lastMessageId,
        peerSeat: fromSeat,
        fromName,
        text,
        direction: "incoming",
        timestamp: Date.now(),
      });

      if (this.activePeerSeat !== fromSeat) {
        this.unreadByPeerSeat[fromSeat] = (this.unreadByPeerSeat[fromSeat] || 0) + 1;
      }
    },

    addOutgoingMessage({
      toSeat,
      toName,
      text,
    }: {
      toSeat: number;
      toName: string;
      text: string;
    }) {
      this.lastMessageId += 1;
      this.messages.push({
        id: this.lastMessageId,
        peerSeat: toSeat,
        fromName: toName,
        text,
        direction: "outgoing",
        timestamp: Date.now(),
      });
    },

    clear() {
      this.activePeerSeat = -1;
      this.draft = "";
      this.messages = [];
      this.unreadByPeerSeat = {};
      this.lastMessageId = 0;
    },
  },
});
