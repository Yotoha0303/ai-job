import {decodeMqttAndProtobuf, getMsgBody, normalizeNumber} from './utils';
import logger from "../logging";
import {BossOption} from '../platform/bossPlatform';
import {TampermonkeyApi, Tools} from "../platform/utils";
import {TechwolfChatProtocol, protoDefinition} from "./protobuf";
import {AiPower} from "../platform/aiPower";
import {LogRecorder} from "../logging/record";
import {UserStore} from "../stores";

const originalWebSocket = Tools.window.WebSocket as typeof WebSocket;
const TARGET_URL: string = 'chat';
const SOCKET_JS_URL = "https://static.zhipin.com/assets/zhipin/geek/socket.js?v=20250313";
const CHAT_CHANNEL_READY_TIMEOUT_MS = 15 * 1000;
const CHAT_CHANNEL_RETRY_INTERVAL_MS = 1000;
const logRecorder: LogRecorder = new LogRecorder('hook');
logRecorder.info("---------------------------------------------------------------");
logRecorder.info("WS Hook Start");

//======================================================================================================================
// 预先定义的ws send以及onmessage拦截
let sendInterceptor: ((data: any) => any) | null = null;
let receiveInterceptor: ((data: any) => any) | null = null;

//======================================================================================================================
let hookMap = new Map()
let hookPrototype = false
let chatWebsocketSetupPromise: Promise<boolean> | null = null;

class WebSocketProxy extends originalWebSocket {
    constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        url = url.replace(":443", "");
        const shouldHook = url.includes(TARGET_URL);

        if (!shouldHook || hookMap.has(url)) {
            return this;
        }
        hookPrototype = true;
        hookMap.set(url, this)
        logRecorder.info("WS Hook success ", url)
        const originalOnMessage = this.onmessage;

        Object.defineProperty(this, 'onmessage', {
            set: (fn: (event: MessageEvent) => void) => {
                this.addEventListener('message', (event: MessageEvent) => {
                    if (receiveInterceptor) {
                        const modifiedData = receiveInterceptor(event.data);
                        const clonedEvent = new MessageEvent('message', {
                            data: modifiedData,
                        });
                        fn.call(this, clonedEvent);
                    } else {
                        fn.call(this, event);
                    }
                });
            },
            get: () => originalOnMessage,
        });

        const originalSend = this.send;
        this.send = (data: any) => {
            if (sendInterceptor) {
                data = sendInterceptor(data);
            }
            return originalSend.call(this, data);
        };
    }
}

Tools.window.WebSocket = WebSocketProxy as any;

function hasChatSendChannel(): boolean {
    if (Tools.window.ChatWebsocket?.send || Tools.window.ChatWebsocketImage?.send) {
        return true;
    }
    try {
        return !!Tools.window.GeekChatCore?.getInstance?.()?.getClient?.()?.client?.send;
    } catch (_) {
        return false;
    }
}

function initChatWebsocketImage(): void {
    try {
        if (Tools.window.ChatWebsocketImage?.init) {
            Tools.window.ChatWebsocketImage.init();
            logger.info("ChatWebsocketImage 初始化完成");
        }
    } catch (e) {
        logger.error("ChatWebsocketImage init 报错:", e);
    }
}

async function ensureChatWebsocketImage(): Promise<boolean> {
    if (hasChatSendChannel()) {
        return true;
    }
    if (chatWebsocketSetupPromise) {
        return chatWebsocketSetupPromise;
    }

    chatWebsocketSetupPromise = (async () => {
        if (!Tools.window.ChatWebsocketImage?.send) {
            await setChatWebsocket();
        }

        const deadline = Date.now() + CHAT_CHANNEL_READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (hasChatSendChannel()) {
                return true;
            }
            initChatWebsocketImage();
            await Tools.sleep(CHAT_CHANNEL_RETRY_INTERVAL_MS);
        }
        return hasChatSendChannel();
    })().finally(() => {
        if (!hasChatSendChannel()) {
            chatWebsocketSetupPromise = null;
        }
    });

    return chatWebsocketSetupPromise;
}

Tools.window.AiJobEnsureChatWebsocket = ensureChatWebsocketImage;

ensureChatWebsocketImage()
    .then(ready => {
        if (ready) {
            logger.info("AI Job 聊天发送通道已就绪");
            window.dispatchEvent(new CustomEvent('ai-job:chat-channel-ready'));
        } else {
            logger.warn("AI Job 聊天发送通道未就绪，投递后自定义消息将延迟重试或跳过");
        }
    })
    .catch(err => {
        logger.error("AI Job 聊天发送通道初始化失败:", err);
    });

/**
 * Hook existing WebSocket instances by intercepting the send method
 */
let hookReceived = false;

function hookExistingWebSockets() {

    const wsInstance = hookPrototype ? Tools.window.WebSocket : originalWebSocket;
    const originalSend = hookPrototype ? Tools.window.WebSocket.prototype.send : originalWebSocket.prototype.send;

    // Override the send method to capture instances and intercept data
    wsInstance.prototype.send = function (data: any) {
        if (hookPrototype) {
            return originalSend.call(this, data);
        }
        if (!hookReceived) {
            logRecorder.info("WS Send Hook Start");
        }
        if (!hookPrototype && sendInterceptor) {
            data = sendInterceptor(data);
        }
        if (!hookMap.has(this.url) && !hookReceived) {
            hookReceived = true;
            hookMap.set(this.url, this);
            hookReceiveForInstance(this);
            logRecorder.info("WS Send Hook Success");
        }
        return originalSend.call(this, data);
    };

    setTimeout(() => {
        if (!hookPrototype) {
            logRecorder.info("WS Send Hook install；wait ws send");
        }
    }, 500)
}

/**
 * Add receive hook for a specific WebSocket instance
 */
function hookReceiveForInstance(wsInstance: WebSocket) {
    // If the instance already has an onmessage handler
    if (wsInstance.onmessage) {
        const originalOnMessage = wsInstance.onmessage;
        wsInstance.onmessage = function (event: MessageEvent) {
            if (receiveInterceptor) {
                const modifiedData = receiveInterceptor(event.data);
                const clonedEvent = new MessageEvent('message', {
                    data: modifiedData,
                });
                return originalOnMessage.call(this, clonedEvent);
            }

            return originalOnMessage.call(this, event);
        };
    }
}

/**
 * Initialize the complete WebSocket hooking system
 */
function setupCompleteWebSocketHook() {
    // Hook existing WebSockets (in case some were created before our hook)
    hookExistingWebSockets();
}

setupCompleteWebSocketHook()

//======================================================================================================================

// 设置拦截器函数
function setSendInterceptor(interceptor: (data: any) => any) {
    sendInterceptor = interceptor;
}

function setReceiveInterceptor(interceptor: (data: any) => any) {
    receiveInterceptor = interceptor;
}


// 设置发送消息拦截器
setSendInterceptor((data) => {
    logger.trace("发送消息原始数据：", data)
    let wsData: TechwolfChatProtocol = decodeMqttAndProtobuf(data, "发送") as TechwolfChatProtocol
    if (!(wsData && wsData?.messages.length >= 1)) {
        return data;
    }
    let msgText = getMsgBody(wsData);
    let toUid = normalizeNumber(wsData.messages[0].to.uid);
    if (!toUid) {
        return data;
    }

    logger.debug("发送消息解码内容：", msgText)
    if (msgText.endsWith(Tools.getEndChar()) || filter(msgText, wsData)) {
        // ai消息，不做拦截；或者是投递之后自动发送的自定义招呼语
        return data;
    }

    // 不是ai发送的消息；用户手动介入了
    let bossUserCache = BossOption.getBossUserInfoByCache(toUid);
    if (!bossUserCache) {
        return data;
    }

    // 手动消息如果是启动命令，则启动ai交流，并拦截当前消息
    if (msgText === "start") {
        let bossUserCache = BossOption.getBossUserInfoByCache(toUid);
        if (!bossUserCache) {
            return;
        }
        // 启动ai交流
        AiPower.updateAskStatus(BossOption.buildJobKey(bossUserCache), false)
            .then(resp => logRecorder.info(`[${bossUserCache?.jobTitle}] 命令启动AI交流：${resp.data.data}`))
        return;
    }

    // 不是启动命令，则停止ai交流
    AiPower.updateAskStatus(BossOption.buildJobKey(bossUserCache), true)
        .then(resp => logRecorder.info(`[${bossUserCache?.jobTitle}] 手动介入关闭AI交流：${resp.data.data}`))
    return data;
});

// 设置接收消息拦截器
setReceiveInterceptor((data) => {
    logger.trace("接收消息原始数据：", data)
    let wsData: TechwolfChatProtocol = decodeMqttAndProtobuf(data, "接收") as TechwolfChatProtocol
    if (!(wsData && wsData?.messages.length >= 1)) {
        return data;
    }
    let msgBody = getMsgBody(wsData);
    let fromUid = normalizeNumber(wsData.messages[0].from.uid);
    if (!fromUid) {
        return data;
    }
    if (Tools.window._PAGE.uid === fromUid) {
        logger.debug("接收到自己的消息='" + msgBody + "'")
        return data;
    }

    if (!userStore) {
        userStore = UserStore();
    }

    // 可能存在配置还未加载，导致这里的aiSeatStatus状态不对（消息页面刷新后第一次可能出现）
    if (!userStore.user.aiSeatStatus) {
        logger.info("AI坐席未开启结束-前置")
        return data;
    }

    let bossOption: BossOption = new BossOption()
    bossOption.handlerBossMessage(wsData, fromUid, msgBody).then();
    return data;
});

//  todo 发送图片简历依赖image对象


let userStore: any;

/**
 * 是否是投递之后自动发送的自定义招呼语以及自定义图片简历
 * @param msg
 * @param wsData
 */
function filter(msg: string, wsData: any): boolean {
    if (!userStore) {
        userStore = UserStore();
    }
    if (msg === userStore?.user?.preference?.cg) {
        return true;
    }

    return wsData.messages[0]?.body?.image

}

/**
 * 拦截并修改目标脚本（如 socket.js），将 ChatWebsocket 暴露到 window 对象
 */
function fetchSocketScript(): Promise<string> {
    return new Promise((resolve, reject) => {
        TampermonkeyApi.GMXmlHttpRequest({
            method: "GET",
            url: SOCKET_JS_URL,
            timeout: 10000,
            onload: (resp: any) => {
                if (resp.status >= 200 && resp.status < 300) {
                    resolve(resp.responseText);
                    return;
                }
                reject(new Error(`socket.js 请求失败，状态码: ${resp.status}`));
            },
            onerror: reject,
            ontimeout: () => reject(new Error("socket.js 请求超时")),
        });
    });
}

async function setChatWebsocket(): Promise<void> {
    logger.info("build ChatWebsocket")
    return fetchSocketScript()
        .then((code) => {
            // 在代码开头注入所需的全局变量
            let injectedVars = `const __PROTO_FILE_VAR__ = '${protoDefinition}';\n`;

            // 修改代码：在 ChatWebsocket 定义后暴露到 window
            let str = '\nTools.window.ChatWebsocketImage = ChatWebsocket;\nconsole.log("set ChatWebsocket 成功", ChatWebsocket)\n';
            let exposeCode = '\nif (typeof ChatWebsocket !== "undefined") { Tools.window.ChatWebsocketImage = ChatWebsocket; console.log("set ChatWebsocket 成功", ChatWebsocket); }\n';
            let modifiedCode = injectedVars + code.replaceAll(/if \(\"EventBus\" in window\) \{\s+EventBus.subscribe\("CHAT_SEND_TEXT".*fail\);\s+}\);\s+}/gs, str)
                .replace("ChatWebsocket.init()", "") + exposeCode;

            try {
                // 使用原生的 Function 执行代码
                new Function("Tools", modifiedCode)(Tools);
                logger.info("window 挂载 ChatWebsocket 成功", Tools.window.ChatWebsocketImage);
            } catch (e) {
                logger.error("执行劫持脚本失败:", e);
                throw e;
            }
            return Promise.resolve();
        })
        .catch((err) => {
            logger.error("setChatWebsocket 捕获到网络或执行异常:", err);
            throw err;
        });
}
