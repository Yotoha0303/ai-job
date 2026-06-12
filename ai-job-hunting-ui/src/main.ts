import { createApp } from 'vue';
import './style.css';
import 'element-plus/dist/index.css'
import PlatformFactory, { Platform } from "./platform/platform";
import App from './App.vue';
import logger, { Logger, LogLevel } from "./logging";
import './webSocket/hookMain'
import { createPinia } from 'pinia'
import axios from "./axios";
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { isProdEnv } from "./utils/tools";

import { ServerStore } from "./stores/server";

const app = createApp(App);
if (!isProdEnv()) {
    Logger.setGlobalLogLevel(LogLevel.Debug)
}
const pinia = createPinia()
app.use(pinia)

const serverStore = ServerStore(pinia)
serverStore.checkConnection()

app.use(ElementPlus, {
    locale: zhCn,
})

const platform: Platform = PlatformFactory.getInstance(location.href);
app.provide('$platform', platform)
app.provide('$axios', axios)

const ROOT_APP_ID = "ai-job";
const rootApp = document.createElement('div');
rootApp.id = ROOT_APP_ID
rootApp.classList.add('page-job-content');

let appMounted = false;
let mounting = false;
let mountWatchTimer: number | null = null;

const insertRootApp = (containerEle: Element, position?: string) => {
    const existingRoot = document.getElementById(ROOT_APP_ID);
    if (existingRoot && existingRoot !== rootApp) {
        existingRoot.remove();
    }
    if (position === "end") {
        containerEle.appendChild(rootApp);
        return;
    }
    containerEle.insertBefore(rootApp, containerEle.firstElementChild);
}

const ensureMounted = async () => {
    if (mounting || document.body?.contains(rootApp)) {
        return;
    }
    mounting = true;
    try {
        const elP = await platform.getMountEle();
        insertRootApp(elP.el, elP.p);
        if (!appMounted) {
            app.mount(rootApp);
            appMounted = true;
        }
    } catch (error) {
        logger.error("AI Job mount failed", error);
    } finally {
        mounting = false;
    }
}

const startMountKeeper = () => {
    ensureMounted();
    if (mountWatchTimer !== null) {
        return;
    }
    mountWatchTimer = window.setInterval(() => {
        ensureMounted();
    }, 1000);

    const observer = new MutationObserver(() => {
        if (!document.body?.contains(rootApp)) {
            ensureMounted();
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", startMountKeeper, { once: true });
} else {
    startMountKeeper();
}
