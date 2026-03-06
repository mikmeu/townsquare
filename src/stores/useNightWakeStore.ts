import { defineStore } from "pinia";
import type { NightWakePrompt, NightWakeResponse } from "@/types";

interface NightWakeState {
  prompt: NightWakePrompt | null;
  responses: NightWakeResponse[];
}

export const useNightWakeStore = defineStore("nightWake", {
  state: (): NightWakeState => ({
    prompt: null,
    responses: [],
  }),

  actions: {
    setPrompt(prompt: NightWakePrompt | null) {
      this.prompt = prompt;
    },

    addResponse(response: NightWakeResponse) {
      this.responses.unshift(response);
      this.responses = this.responses.slice(0, 20);
    },

    clearResponses() {
      this.responses = [];
    },

    clearAll() {
      this.prompt = null;
      this.responses = [];
    },
  },
});
