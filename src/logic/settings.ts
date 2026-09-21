/**
 * 持久化存档的版本与迁移。
 *
 * pet-store.json 里的 settings 没有内嵌版本字段，老存档缺新 key 时靠
 * mergeSettings 用默认值兜底——新增设置项时只需更新 DEFAULT_SETTINGS，
 * 不必担心老用户存档炸掉。若未来要做破坏性改名（如皮肤 key 变更），
 * 在此处按 SETTINGS_VERSION 逐级迁移。
 */

import type { PetSettings } from "@/types";

/** 当前存档结构版本；仅在引入需要迁移的破坏性变更时递增 */
export const SETTINGS_VERSION = 1;

export function mergeSettings(
  defaults: PetSettings,
  raw: Partial<PetSettings> | undefined | null,
): PetSettings {
  if (!raw) return { ...defaults };
  const merged = { ...defaults, ...raw };
  // 防御旧存档里的非法值（滑条范围见 SettingsPanel.vue）
  merged.petSize = Math.min(Math.max(merged.petSize ?? defaults.petSize, 200), 500);
  merged.animationSpeed = Math.min(
    Math.max(merged.animationSpeed ?? defaults.animationSpeed, 0.5),
    2,
  );
  merged.breakAfterMin = Math.min(
    Math.max(merged.breakAfterMin ?? defaults.breakAfterMin, 15),
    240,
  );
  return merged;
}
