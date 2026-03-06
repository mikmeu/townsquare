export type NightWakeActionType =
  | "selectPlayer"
  | "selectTwoPlayers"
  | "selectCharacter"
  | "selectPlayerAndCharacter";

export type NightWakeInfoType =
  | "yes"
  | "no"
  | "good"
  | "evil"
  | "number"
  | "minions"
  | "demon"
  | "notInPlay"
  | "youAre"
  | "thisPlayerIs"
  | "spyScreenshot";

export interface NightWakeInfo {
  type: NightWakeInfoType;
  numberValue?: number;
  playerIds?: string[];
  playerId?: string;
  roleIds?: string[];
  roleId?: string;
  alignment?: "good" | "evil";
  imageDataUrl?: string;
}

export interface NightWakePrompt {
  id: string;
  targetPlayerId: string;
  targetSeat: number;
  targetName: string;
  roleId?: string;
  roleName?: string;
  nightInfo?: string;
  mode: "action" | "info";
  actionType?: NightWakeActionType;
  info?: NightWakeInfo;
  createdAt: number;
}

export interface NightWakeSelection {
  playerId?: string;
  playerIds?: string[];
  roleId?: string;
}

export interface NightWakeResponse {
  promptId: string;
  promptMode: "action" | "info";
  fromPlayerId: string;
  fromSeat: number;
  fromName: string;
  actionType?: NightWakeActionType;
  selection?: NightWakeSelection;
  createdAt: number;
}
