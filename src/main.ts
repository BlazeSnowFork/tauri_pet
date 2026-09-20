import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App.vue";
import ContextMenu from "./components/ContextMenu.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import "./styles/main.css";
import "./styles/pet.css";
import "./styles/ui.css";

// 同一份前端产物服务三个窗口：
// main          —— 宠物本体（透明置顶小窗）
// pet-menu      —— 右键菜单（独立窗口，避免被小窗口裁剪）
// pet-settings  —— 设置面板（独立窗口，避免被小窗口裁剪）
const label = getCurrentWindow().label;

const rootComponent =
  label === "pet-menu" ? ContextMenu : label === "pet-settings" ? SettingsPanel : App;

createApp(rootComponent).use(createPinia()).mount("#app");
