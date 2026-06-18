import {
    FetchJobBossFailExp,
    NotMatchException,
    PlatformError,
    PublishLimitExp,
    PublishStopExp,
    PushReqException
} from "../exp";
import {simulateScrollToEnd, TampermonkeyApi, Tools} from "./utils";
import logger, {LogLevel} from '../logging'
import axiosOriginal from "axios";
import {PushResultStatus, PushStatus} from "../enums";
import {Message} from "../webSocket/protobuf";
import {LogRecorder} from "../logging/record";
import {pushResultCount, UserStore} from "../stores";
import {userRemoteLoad} from "../stores/remote";
import {AiPower} from "./aiPower";

let pushResultCounter: any;
let userStore: any;

const MAX_CONSECUTIVE_NOT_MATCH_COUNT = 30;
const JOB_PROGRESS_STORAGE_PREFIX = 'ai-job:push:job-progress:v1:';
const JOB_PROGRESS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const POST_PUSH_QUEUE_STORAGE_PREFIX = 'ai-job:post-push-queue:v1:';
const POST_PUSH_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const POST_PUSH_QUEUE_PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;
const POST_PUSH_QUEUE_WORKER_INTERVAL_MS = 5000;
const POST_PUSH_QUEUE_MAX_RETRY = 5;

type JobProgressStatus = 'processing' | 'skipped' | 'success' | 'failed';

interface JobProgressRecord {
    status: JobProgressStatus;
    updatedAt: number;
    reason?: string;
}

type JobProgressMap = Record<string, JobProgressRecord>;

type PostPushActionType = 'greeting' | 'image';
type PostPushActionStatus = 'pending' | 'processing' | 'success' | 'failed';

interface PostPushActionPayload {
    greeting?: string;
    image?: {
        originImage: string;
        tinyImage: string;
    };
}

interface PostPushJobSnapshot {
    jobKey: string;
    jobTitle: string;
    encryptBossId: string;
    securityId: string;
    bossId?: string;
}

interface PostPushQueueItem {
    id: string;
    action: PostPushActionType;
    status: PostPushActionStatus;
    retryCount: number;
    createdAt: number;
    updatedAt: number;
    lastError?: string;
    job: PostPushJobSnapshot;
    payload: PostPushActionPayload;
}

type PostPushQueueMap = Record<string, PostPushQueueItem>;


export enum PlatformTypeEnum {
    Boss,
    // ZhiLian,//智联
    // 前职无忧
    LiePin,
    UnKnow,
}

export interface ElementP {
    el: Element,
    p?: string
}


export interface Platform {
    name: string,
    urlList: string[],
    curUrl: string,

    getMountEle(): Promise<ElementP>;

    getRenderComponent(): any;

    startPush(): Promise<void>;

    pausePush(): void;

    scrollToBottomThenTop(): Promise<void>;

    getPlatformType(): PlatformTypeEnum;
}


export abstract class AbsPlatform implements Platform {
    abstract name: string;
    abstract curUrl: string;
    abstract urlList: string[];
    protected logRecorder: LogRecorder = new LogRecorder('recorder');

    protected pushStatus: PushStatus = PushStatus.NOT_START
    protected _pushMock: boolean = false;
    private _selfDefPushCountLimit = -1


    set pushMock(value: boolean) {
        this._pushMock = value;
    }

    set selfDefPushCountLimit(value: number) {
        this._selfDefPushCountLimit = value;
    }

    get selfDefPushCountLimit(): number {
        return this._selfDefPushCountLimit;
    }

    abstract getPlatformType(): PlatformTypeEnum;

    abstract getMountEle(): Promise<ElementP>;

    abstract getRenderComponent(): Promise<any>;

    private getJobProgressStorageKey(): string {
        return JOB_PROGRESS_STORAGE_PREFIX + this.getJobProgressScopeKey();
    }

    private getJobProgressScopeKey(): string {
        return `${this.getPlatformType()}:${window.location.origin}${window.location.pathname}${window.location.search}`;
    }

    private readJobProgress(): JobProgressMap {
        const rawProgress = localStorage.getItem(this.getJobProgressStorageKey());
        if (!rawProgress) {
            return {};
        }
        try {
            const progress = JSON.parse(rawProgress) as JobProgressMap;
            if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
                localStorage.removeItem(this.getJobProgressStorageKey());
                return {};
            }
            const now = Date.now();
            Object.entries(progress).forEach(([key, record]) => {
                if (!record?.updatedAt || now - record.updatedAt > JOB_PROGRESS_MAX_AGE_MS) {
                    delete progress[key];
                }
            });
            return progress;
        } catch (error) {
            logger.warn("读取投递进度失败", error);
            localStorage.removeItem(this.getJobProgressStorageKey());
            return {};
        }
    }

    private writeJobProgress(progress: JobProgressMap): void {
        localStorage.setItem(this.getJobProgressStorageKey(), JSON.stringify(progress));
    }

    protected getPersistentJobKey(jobDetail: JobDetail): string {
        return this.getJobKey(jobDetail);
    }

    protected markJobProgress(jobDetail: JobDetail, status: JobProgressStatus, reason = ''): void {
        const jobKey = this.getPersistentJobKey(jobDetail);
        if (!jobKey) {
            return;
        }
        const progress = this.readJobProgress();
        progress[jobKey] = {
            status,
            updatedAt: Date.now(),
            reason,
        };
        this.writeJobProgress(progress);
    }

    protected shouldSkipPersistedJob(jobDetail: JobDetail): boolean {
        const jobKey = this.getPersistentJobKey(jobDetail);
        if (!jobKey) {
            return false;
        }
        const record = this.readJobProgress()[jobKey];
        return !!record && record.status !== 'processing';
    }

    protected filterPendingJobs<T extends JobDetail>(jobList: T[]): T[] {
        return jobList.filter(job => !(job as any).processed && !this.shouldSkipPersistedJob(job));
    }

    async startPush() {
        this.logRecorder.info("开始投递")
        // 每次投递前清空单次成功计数器
        pushResultCounter.clearOnceSuccessCount()
        this.pushStatus = PushStatus.PUSHING;
        this.startPreHandler()
        this.scrollDownOnStart()
        let consecutiveNotMatchCount = 0;
        do {
            // 获取jobDetail集合并过滤
            let jobList = this.getJobList();
            if (jobList.length === 0) {
                if (!(await this.next())) {
                    break;
                }
                continue;
            }
            for (const jobDetail of jobList) {
                let shouldScrollAfterJob = true;
                try {
                    this.preMatchJob();
                    this.markJobProgress(jobDetail, 'processing');
                    await this.matchJob(jobDetail);
                    consecutiveNotMatchCount = 0;
                    this.pushPreHandler(jobDetail);
                    const pushResult = await this.push(jobDetail);
                    await this.pushAfterHandler(pushResult, jobDetail);
                    this.markJobProgress(jobDetail, 'success');
                } catch (error) {
                    switch (true) {
                        case error instanceof NotMatchException:
                            this.markJobProgress(jobDetail, 'skipped', error.message);
                            consecutiveNotMatchCount++;
                            if (this.logRecorder.getLogLevel() === LogLevel.Debug) {
                                this.logRecorder.info(`工作【${error.jobTitle}】被过滤 原因：${error.message} 当前值:${error.data}`)
                            } else {
                                this.logRecorder.info(`工作【${error.jobTitle}】被过滤 原因：${error.message}`)
                            }
                            pushResultCounter.notMatchIncr()
                            if (consecutiveNotMatchCount >= MAX_CONSECUTIVE_NOT_MATCH_COUNT) {
                                shouldScrollAfterJob = false;
                                this.logRecorder.info(`连续过滤${MAX_CONSECUTIVE_NOT_MATCH_COUNT}个岗位，自动停止投递`)
                                return;
                            }
                            break;

                        case error instanceof PushReqException:
                            this.markJobProgress(jobDetail, 'failed', error.message);
                            consecutiveNotMatchCount = 0;
                            this.logRecorder.warn(`工作【${error.jobTitle}】投递失败 原因：${error.message}`)
                            pushResultCounter.failIncr()
                            break

                        case error instanceof FetchJobBossFailExp:
                            this.markJobProgress(jobDetail, 'failed', error.message);
                            consecutiveNotMatchCount = 0;
                            this.logRecorder.warn(`工作【${error.jobTitle}】发送自定义招呼语失败 原因：${error.message}`)
                            break

                        // 投递停止；手动停止.结束链路
                        case error instanceof PublishStopExp:
                            shouldScrollAfterJob = false;
                            this.logRecorder.info("手动暂停投递 " + error.message)
                            return;
                        // 投递限制；平台限制.结束链路
                        case error instanceof PublishLimitExp:
                            shouldScrollAfterJob = false;
                            this.logRecorder.info("停止投递 " + error.message)
                            return;

                        default:
                            logger.error("未捕获异常--->", error)
                    }
                } finally {
                    if (shouldScrollAfterJob && this.pushStatus === PushStatus.PUSHING) {
                        await this.afterJobHandled(jobDetail).catch(e => {
                            this.logRecorder.warn("自动向下滑动失败", e)
                        })
                    }
                }
            }
        } while (await this.next())
        this.logRecorder.info("结束投递")
    }

    next = async () => {
        if (this.pushStatus == PushStatus.PAUSE) {
            return false;
        }
        if (this.hasPendingLoadedJob()) {
            return true;
        }
        let next = this.hasNext();
        if (!next) {
            this.logRecorder.info("无下一页数据")
            return false;
        }
        await Tools.sleep(userStore.user.preference.npi * 1000)
        const acquired = await this.acquireDataPre();
        if (!acquired) {
            this.logRecorder.info("无法继续下滑获取新岗位，自动停止投递")
            return false;
        }
        await Tools.sleep(3000)
        return next
    };

    pausePush(): void {
    }

    async scrollToBottomThenTop(): Promise<void> {
        await this.scrollWindowToBottomUntilStable();
        this.scrollWindowToTop();
    }

    protected async scrollWindowToBottomUntilStable(maxAttempts = 60, stableThreshold = 2, waitMs = 1200): Promise<void> {
        let stableCount = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const moved = await this.humanScrollWindowDownOnce(waitMs);
            if (!moved) {
                stableCount++;
                if (stableCount >= stableThreshold) {
                    return;
                }
            } else {
                stableCount = 0;
            }
        }
    }

    protected async humanScrollWindowDownOnce(waitMs = 1200): Promise<boolean> {
        const oldHeight = this.getWholePageScrollHeight();
        const oldTop = window.scrollY;
        const maxTop = Math.max(0, oldHeight - window.innerHeight);
        const distance = Math.max(260, Math.floor(window.innerHeight * 0.8));
        const targetTop = Math.min(maxTop, oldTop + distance);
        const steps = Math.max(6, Math.ceil(Math.max(1, targetTop - oldTop) / 120));

        for (let step = 1; step <= steps; step++) {
            const nextTop = oldTop + ((targetTop - oldTop) * step / steps);
            const deltaY = nextTop - window.scrollY || distance / steps;
            window.dispatchEvent(new WheelEvent('wheel', {
                deltaY,
                bubbles: true,
                cancelable: true,
                view: window
            }));
            window.scrollTo({
                top: nextTop,
                behavior: 'auto'
            });
            window.dispatchEvent(new Event('scroll'));
            await Tools.sleep(Tools.getRandomNumber(35, 80));
        }

        await Tools.sleep(waitMs);
        const newHeight = this.getWholePageScrollHeight();
        const newTop = window.scrollY;
        return newHeight > oldHeight || newTop > oldTop;
    }

    protected scrollWindowToTop(): void {
        window.scrollTo({
            top: 0,
            behavior: document.hidden ? 'auto' : 'smooth'
        });
    }

    private getWholePageScrollHeight(): number {
        const documentElement = document.documentElement;
        return Math.max(
            document.body.scrollHeight,
            documentElement.scrollHeight,
            document.body.offsetHeight,
            documentElement.offsetHeight,
            document.body.clientHeight,
            documentElement.clientHeight
        );
    }

    abstract hasNext(): boolean;

    abstract acquireDataPre(): Promise<boolean>;

    abstract startPreHandler(): void;

    protected scrollDownOnStart(): void {
    }

    protected hasPendingLoadedJob(): boolean {
        return false;
    }

    protected async afterJobHandled(_jobDetail: JobDetail): Promise<void> {
    }

    abstract getJobList(): JobDetail[];

    abstract matchJob(jobDetail: JobDetail): Promise<boolean>;

    abstract pushPreHandler(jobDetail: JobDetail): JobDetail;

    preMatchJob(): void {
        // 投递前检查，避免无意义的匹配过滤
        if (this._selfDefPushCountLimit !== -1 && pushResultCounter.onceSuccessCount >= this._selfDefPushCountLimit) {
            throw new PublishLimitExp("自定义投递次数限制")
        }
        if (this.pushStatus == PushStatus.PAUSE) {
            throw new PublishStopExp("手动暂停投递")
        }
    }

    async push(jobDetail: JobDetail): Promise<PushResult> {
        if (this.pushStatus == PushStatus.PAUSE) {
            throw new PublishStopExp("手动暂停投递")
        }

        if (this._selfDefPushCountLimit !== -1 && pushResultCounter.onceSuccessCount >= this._selfDefPushCountLimit) {
            throw new PublishLimitExp("自定义投递次数限制")
        }

        // 检查投递限制
        let limitResult = this.isLimit(jobDetail);
        if (limitResult.limit) {
            throw new PublishLimitExp(limitResult.msg)
        }

        if (this._pushMock) {
            let jobTitle = this.getJobKey(jobDetail);
            logger.debug("mock投递 ", jobTitle)
            return {
                message: 'Success',
                code: 0
            }
        }
        return await this.doPush(jobDetail);
    }

    isLimit(jobDetail: JobDetail): { limit: boolean, msg: string } {
        return {
            limit: false,
            msg: this.getJobKey(jobDetail)
        }
    }

    abstract doPush(jobDetail: JobDetail): Promise<any>;

    abstract pushAfterHandler(pushResult: PushResult, jobDetail: JobDetail): Promise<any> ;

    abstract getJobKey(jobDetail: JobDetail): string;

    getFistJobDetail(): JobDetail {
        return this.getJobList()[0]
    }
}


class BossPlatform extends AbsPlatform {
    curUrl: string;
    name = "Boss";
    urlList = ["/web/geek", "overseas"];
    lastHeight = 0;
    private lastJobHandledScrollTime = 0;
    private readonly jobHandledScrollInterval = 800;
    private postPushQueueWorkerTimer: number | null = null;
    private postPushQueueProcessing = false;


    constructor(curUrl: string) {
        super();
        this.curUrl = curUrl;
        window.setTimeout(() => this.startPostPushQueueWorker(), 0);
    }

    protected getPersistentJobKey(jobDetail: BossJobDetail): string {
        const keyParts = [
            jobDetail.encryptJobId,
            jobDetail.securityId,
            jobDetail.lid,
            jobDetail.encryptBossId,
        ].filter(item => item !== undefined && item !== null && item !== '');
        return keyParts.length > 0 ? keyParts.join(':') : super.getPersistentJobKey(jobDetail);
    }

    private getPostPushQueueStorageKey(): string {
        const userId = Tools.window?._PAGE?.uid || 'unknown';
        return `${POST_PUSH_QUEUE_STORAGE_PREFIX}${this.getPlatformType()}:${window.location.origin}:${userId}`;
    }

    private readPostPushQueue(): PostPushQueueMap {
        const rawQueue = localStorage.getItem(this.getPostPushQueueStorageKey());
        if (!rawQueue) {
            return {};
        }
        try {
            const queue = JSON.parse(rawQueue) as PostPushQueueMap;
            if (!queue || typeof queue !== 'object' || Array.isArray(queue)) {
                localStorage.removeItem(this.getPostPushQueueStorageKey());
                return {};
            }
            const now = Date.now();
            Object.entries(queue).forEach(([id, item]) => {
                if (!item?.updatedAt || now - item.updatedAt > POST_PUSH_QUEUE_MAX_AGE_MS) {
                    delete queue[id];
                    return;
                }
                if (item.status === 'processing' && now - item.updatedAt > POST_PUSH_QUEUE_PROCESSING_TIMEOUT_MS) {
                    item.status = 'pending';
                    item.updatedAt = now;
                }
            });
            return queue;
        } catch (error) {
            logger.warn("读取投递后置发送队列失败", error);
            localStorage.removeItem(this.getPostPushQueueStorageKey());
            return {};
        }
    }

    private writePostPushQueue(queue: PostPushQueueMap): void {
        localStorage.setItem(this.getPostPushQueueStorageKey(), JSON.stringify(queue));
    }

    private getPostPushActionName(action: PostPushActionType): string {
        return action === 'image' ? '自定义图片' : '自定义招呼语';
    }

    private getPostPushActionId(jobKey: string, action: PostPushActionType): string {
        return `${jobKey}:${action}`;
    }

    private buildPostPushJobSnapshot(jobDetail: BossJobDetail): PostPushJobSnapshot {
        return {
            jobKey: this.getPersistentJobKey(jobDetail),
            jobTitle: this.getJobKey(jobDetail),
            encryptBossId: jobDetail.encryptBossId,
            securityId: jobDetail.securityId,
        };
    }

    private enqueuePostPushAction(jobDetail: BossJobDetail, action: PostPushActionType, payload: PostPushActionPayload): void {
        const job = this.buildPostPushJobSnapshot(jobDetail);
        if (!job.jobKey || !job.encryptBossId || !job.securityId) {
            this.logRecorder.warn(`工作【${job.jobTitle}】${this.getPostPushActionName(action)}入队失败，缺少Boss标识`)
            return;
        }

        const id = this.getPostPushActionId(job.jobKey, action);
        const queue = this.readPostPushQueue();
        const existing = queue[id];
        if (existing && ['pending', 'processing', 'success'].includes(existing.status)) {
            this.logRecorder.info(`工作【${job.jobTitle}】${this.getPostPushActionName(action)}已在待发送队列中，跳过重复入队`)
            return;
        }

        const now = Date.now();
        queue[id] = {
            id,
            action,
            status: 'pending',
            retryCount: existing?.status === 'failed' ? 0 : existing?.retryCount ?? 0,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            job,
            payload,
        };
        this.writePostPushQueue(queue);
        this.logRecorder.info(`工作【${job.jobTitle}】${this.getPostPushActionName(action)}已加入待发送队列`)
        this.processPostPushQueue().then();
    }

    private enqueuePostPushActions(jobDetail: BossJobDetail): void {
        const jobTitle = this.getJobKey(jobDetail);
        if (this._pushMock) {
            this.logRecorder.info(`工作【${jobTitle}】当前为模拟投递，跳过投递后置发送`)
            return;
        }

        if (userStore.user.preference.cIE) {
            const customerImageSet = userStore.user.preference.cI;
            if (!customerImageSet) {
                this.logRecorder.info(`工作【${jobTitle}】自定义图片配置为空，跳过发送`)
            } else {
                const [originImage, tinyImage] = customerImageSet.split("===");
                if (!originImage || !tinyImage) {
                    this.logRecorder.warn(`工作【${jobTitle}】自定义图片配置异常，跳过发送`)
                } else {
                    this.enqueuePostPushAction(jobDetail, 'image', {
                        image: {
                            originImage,
                            tinyImage,
                        },
                    });
                }
            }
        } else {
            this.logRecorder.info(`工作【${jobTitle}】未开启自定义图片，跳过发送`)
        }

        if (userStore.user.preference.cgE) {
            const customGreeting = userStore.user.preference.cg;
            if (!customGreeting) {
                this.logRecorder.info(`工作【${jobTitle}】自定义招呼语为空，跳过发送`)
            } else {
                this.enqueuePostPushAction(jobDetail, 'greeting', {
                    greeting: customGreeting,
                });
            }
        } else {
            this.logRecorder.info(`工作【${jobTitle}】未开启自定义招呼语，跳过发送`)
        }
    }

    getPlatformType(): PlatformTypeEnum {
        return PlatformTypeEnum.Boss;
    }


    private findMountEle(): ElementP | null {
        let element: Element | null = null;
        let p = "";
        if (this.curUrl.includes("www.zhipin.com/web/geek/chat")) {
            element = document.querySelector(".chat-conversation");
        }
        if (this.curUrl.includes("www.zhipin.com/web/geek/job-recommend")) {
            element = document.querySelector(".recommend-search-inner");
            // element = document.querySelector(".recommend-result-inner");
            p = "end";
        }
        if (this.curUrl.includes("www.zhipin.com/web/geek/jobs")) {
            element = document.querySelector(".job-recommend-result");
            // p = "end";
        } else if (this.curUrl.includes("www.zhipin.com/web/geek/job")) {
            element = document.querySelector(".page-job-inner");
        }

        if (this.curUrl.includes("overseas")) {
            element = document.querySelector(".mod-header");
        }

        if (!element) {
            return null;
        }
        return {
            el: element,
            p: p
        }
    }


    getMountEle(): Promise<ElementP> {
        return new Promise<ElementP>((resolve) => {
            const maxCount = 100;
            let count: number = 0;
            let interval = setInterval(() => {
                const mountEle = this.findMountEle();
                if (mountEle !== null) {
                    clearInterval(interval);
                    return resolve(mountEle)
                }
                if (count >= maxCount) {
                    clearInterval(interval);
                    logger.error(PlatformTypeEnum.Boss, "获取平台挂载元素失败")
                    return resolve({
                        el: document.body || document.documentElement,
                        p: "end"
                    })
                }
                count++;
            }, 300);
        })
    }


    async getRenderComponent(): Promise<any> {
        if (this.curUrl.includes("www.zhipin.com/web/geek/chat")) {
            let promise = import('../components/ui/BossMessage.vue');
            return promise.then(item => item.default)
        }
        if (this.curUrl.includes("www.zhipin.com/web/geek/job") || this.curUrl.includes("overseas")) {
            let promise = import('../components/ui/BossJobList.vue');
            return promise.then(item => item.default)
        }

    }

    startPreHandler(): void {
        this.lastHeight = 0;
        this.lastJobHandledScrollTime = 0;
    }

    protected scrollDownOnStart(): void {
        window.setTimeout(() => {
            this.scrollDownForMoreJobs().catch(e => {
                this.logRecorder.warn("自动向下滑动失败", e)
            });
        }, 0)
    }

    protected hasPendingLoadedJob(): boolean {
        return this.getJobList().length > 0;
    }

    protected async afterJobHandled(_jobDetail: JobDetail): Promise<void> {
        const now = Date.now();
        if (now - this.lastJobHandledScrollTime < this.jobHandledScrollInterval) {
            return;
        }
        this.lastJobHandledScrollTime = now;
        await this.scrollDownForMoreJobs();
    }

    async scrollToBottomThenTop(): Promise<void> {
        const scrollElement = this.getInfiniteScrollElement();
        if (!scrollElement) {
            await super.scrollToBottomThenTop();
            return;
        }

        const moved = await this.scrollElementToBottomUntilStable(scrollElement);
        if (!moved) {
            await super.scrollToBottomThenTop();
            return;
        }
        this.scrollElementToTop(scrollElement);
    }

    private async scrollDownForMoreJobs(): Promise<void> {
        const scrollElement = this.getInfiniteScrollElement();
        if (scrollElement) {
            await this.humanDragScrollElementDownOnce(scrollElement, 1000);
            return;
        }
        await this.humanScrollWindowDownOnce(1000);
    }

    private async scrollElementToBottomUntilStable(element: HTMLElement, maxAttempts = 80, stableThreshold = 2): Promise<boolean> {
        let stableCount = 0;
        let movedAny = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const moved = await this.humanDragScrollElementDownOnce(element, 2500);
            if (!moved) {
                stableCount++;
                if (stableCount >= stableThreshold) {
                    return movedAny;
                }
            } else {
                movedAny = true;
                stableCount = 0;
            }
            await Tools.sleep(300);
        }
        return movedAny;
    }

    private async humanDragScrollElementDownOnce(element: HTMLElement | null, waitTimeout = 2500): Promise<boolean> {
        if (!element) {
            return false;
        }

        const oldHeight = element.scrollHeight;
        const oldTop = element.scrollTop;
        const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
        const distance = Math.max(260, Math.floor(element.clientHeight * 0.8));
        const targetTop = Math.min(maxTop, oldTop + distance);
        const scrollDistance = Math.max(1, targetTop - oldTop);
        const steps = Math.max(8, Math.ceil(scrollDistance / 110));

        for (let step = 1; step <= steps; step++) {
            const nextTop = oldTop + ((targetTop - oldTop) * step / steps);
            const deltaY = nextTop - element.scrollTop || distance / steps;
            this.dispatchHumanWheel(element, deltaY);
            element.scrollTop = nextTop;
            element.dispatchEvent(new Event('scroll', {bubbles: true}));
            await Tools.sleep(Tools.getRandomNumber(35, 85));
        }

        if (targetTop <= oldTop) {
            this.dispatchHumanWheel(element, distance);
            element.dispatchEvent(new Event('scroll', {bubbles: true}));
        }

        await this.waitForElementScrollHeightChange(element, oldHeight, waitTimeout);
        const newHeight = element.scrollHeight;
        const newTop = element.scrollTop;
        return newHeight > oldHeight || newTop > oldTop;
    }

    private dispatchHumanWheel(element: HTMLElement, deltaY: number): void {
        element.dispatchEvent(new WheelEvent('wheel', {
            deltaY,
            bubbles: true,
            cancelable: true,
            view: window
        }));
    }

    private scrollElementToTop(element: HTMLElement): void {
        if (element) {
            element.scrollTo({
                top: 0,
                behavior: document.hidden ? 'auto' : 'smooth'
            });
        }
        this.scrollWindowToTop();
    }

    private getInfiniteScrollElement(): HTMLElement | null {
        const jobListElement = this.findScrollableJobCardParent();
        if (jobListElement) {
            return jobListElement;
        }

        const selectors = this.getInfiniteScrollCandidateSelectors();
        for (const selector of selectors) {
            const element = document.querySelector(selector) as HTMLElement | null;
            const scrollElement = this.findScrollableElement(element);
            if (scrollElement) {
                return scrollElement;
            }
        }
        return this.findScrollableJobCardParent();
    }

    private getInfiniteScrollCandidateSelectors(): string[] {
        if (this.curUrl.includes("jobs")) {
            return [
                ".job-list-container",
                ".job-list-wrapper",
                ".job-list-box"
            ];
        }
        if (this.curUrl.includes("overseas")) {
            return [
                ".job-list",
                ".job-list-container",
                ".job-list-wrapper",
                ".job-list-box"
            ];
        }
        return [];
    }

    private findScrollableElement(element: HTMLElement | null): HTMLElement | null {
        if (!element) {
            return null;
        }
        if (this.isScrollableElement(element)) {
            return element;
        }
        return Array.from(element.querySelectorAll<HTMLElement>('*')).find(item => this.isScrollableElement(item)) || null;
    }

    private findScrollableJobCardParent(): HTMLElement | null {
        const jobCard = document.querySelector<HTMLElement>(".job-card-wrap,.job-card-box,.job-card-wrapper");
        let element = jobCard?.parentElement || null;
        while (element && element !== document.body && element !== document.documentElement) {
            if (this.isScrollableElement(element) && !this.containsJobDetailPane(element)) {
                return element;
            }
            element = element.parentElement;
        }
        return null;
    }

    private isScrollableElement(element: HTMLElement): boolean {
        if (this.isJobDetailElement(element)) {
            return false;
        }
        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY;
        const canScrollByStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        if (element.scrollHeight <= element.clientHeight + 8) {
            return false;
        }
        if (canScrollByStyle) {
            return true;
        }
        const oldTop = element.scrollTop;
        const targetTop = oldTop < element.scrollHeight - element.clientHeight ? oldTop + 1 : oldTop - 1;
        element.scrollTop = targetTop;
        const canMove = element.scrollTop !== oldTop;
        element.scrollTop = oldTop;
        return canMove;
    }

    private isJobDetailElement(element: HTMLElement): boolean {
        return !!element.closest(".job-detail-container,.job-detail,.job-sec,.detail-content,.job-detail-box");
    }

    private containsJobDetailPane(element: HTMLElement): boolean {
        return !!element.querySelector(".job-detail-container,.job-detail,.job-sec,.detail-content,.job-detail-box");
    }

    getJobList(): BossJobDetail[] {
        // boss 推荐职位页面 或者jobs页面
        if (this.curUrl.includes("jobs")) {
            let elementNodeList = document.querySelectorAll<any>(".job-card-wrap");
            let jobList = this.filterPendingJobs(Array.from(elementNodeList).map(item => item.__vue__.data) as BossJobDetail[]);
            if (elementNodeList.length != 0 && jobList.length == 0) {
                this.logRecorder.info("当前筛选条件下岗位均已投递")
            }
            return jobList;
        }
        if (this.curUrl.includes("job-recommend")) {
            let elementNodeList = document.querySelectorAll<any>(".job-card-wrap");
            return this.filterPendingJobs(Array.from(elementNodeList).map(item => item.__vue__.data).filter(job => !job.contact) as BossJobDetail[]);
        }
        if (this.curUrl.includes("overseas")) {
            let elementNodeList = document.querySelectorAll<any>(".job-card-box");
            return this.filterPendingJobs(Array.from(elementNodeList).map(item => item.__vue__.data).filter(job => !job.contact) as BossJobDetail[]);
        }
        let elementNodeList = document.querySelectorAll<any>(".job-card-wrapper");
        return this.filterPendingJobs(Array.from(elementNodeList).map(item => item.__vue__.data) as BossJobDetail[]);
    }

    hasNext(): boolean {
        logger.debug("hasNext")
        if (this.isInfiniteScrollPage()) {
            return !!this.getInfiniteScrollElement() || this.canScrollWindow()
        }
        if (this.curUrl.includes("job-recommend")) {
            return this.canScrollWindow() || !!document.querySelector("#footer");
        }
        let nextPageBtn = document.querySelector(".ui-icon-arrow-right") as any;
        if (nextPageBtn === null) {
            return false;
        }
        return nextPageBtn.parentElement.className !== "disabled";
    }

    private isInfiniteScrollPage(): boolean {
        return this.curUrl.includes("jobs") || this.curUrl.includes("overseas");
    }

    private getDocumentScrollHeight(): number {
        const documentElement = document.documentElement;
        return Math.max(
            document.body.scrollHeight,
            documentElement.scrollHeight,
            document.body.offsetHeight,
            documentElement.offsetHeight,
            document.body.clientHeight,
            documentElement.clientHeight
        );
    }

    private canScrollWindow(): boolean {
        return window.scrollY < this.getDocumentScrollHeight() - window.innerHeight - 2;
    }

    private async waitForElementScrollHeightChange(element: HTMLElement, oldHeight: number, timeout = 8000): Promise<void> {
        if (!element || oldHeight <= 0 || element.scrollHeight !== oldHeight) {
            return;
        }

        await new Promise<void>(resolve => {
            let done = false;
            let timer: number | undefined;
            const observer = new MutationObserver(() => {
                if (element.scrollHeight !== oldHeight) {
                    cleanup();
                }
            });
            const cleanup = () => {
                if (done) {
                    return;
                }
                done = true;
                observer.disconnect();
                if (timer) {
                    clearTimeout(timer);
                }
                resolve();
            };
            observer.observe(element, {childList: true, subtree: true});
            timer = window.setTimeout(cleanup, timeout);
        });
    }

    private async waitForDocumentScrollHeightChange(oldHeight: number, timeout = 8000): Promise<void> {
        const element = document.body || document.documentElement;
        if (!element || oldHeight <= 0 || this.getDocumentScrollHeight() !== oldHeight) {
            return;
        }

        await new Promise<void>(resolve => {
            let done = false;
            let timer: number | undefined;
            const observer = new MutationObserver(() => {
                if (this.getDocumentScrollHeight() !== oldHeight) {
                    cleanup();
                }
            });
            const cleanup = () => {
                if (done) {
                    return;
                }
                done = true;
                observer.disconnect();
                if (timer) {
                    clearTimeout(timer);
                }
                resolve();
            };
            observer.observe(element, {childList: true, subtree: true});
            timer = window.setTimeout(cleanup, timeout);
        });
    }

    private async loadMoreByElementScroll(element: HTMLElement | null, waitTimeout = 8000): Promise<boolean> {
        if (!element) {
            return false;
        }
        const oldHeight = element.scrollHeight;
        const oldTop = element.scrollTop;
        this.lastHeight = oldHeight;
        await this.humanDragScrollElementDownOnce(element, waitTimeout);
        const newHeight = element.scrollHeight;
        const newTop = element.scrollTop;
        return newHeight > oldHeight || newTop > oldTop;
    }

    private async loadMoreByWindowScroll(): Promise<boolean> {
        const oldHeight = this.getDocumentScrollHeight();
        const oldTop = window.scrollY;
        await simulateScrollToEnd();
        await Tools.sleep(500);
        await this.waitForDocumentScrollHeightChange(oldHeight);
        const newHeight = this.getDocumentScrollHeight();
        const newTop = window.scrollY;
        return newHeight > oldHeight || newTop > oldTop;
    }

    async acquireDataPre(): Promise<boolean> {
        // 在等待下一页时点击了停止，不继续获取下一页数据
        if (this.pushStatus == PushStatus.PAUSE) {
            return false;
        }
        const scrollElement = this.getInfiniteScrollElement();
        if (scrollElement) {
            return await this.loadMoreByElementScroll(scrollElement).then(loaded => {
                if (loaded) {
                    logger.info("获取下一页成功")
                }
                return loaded;
            }).catch(e => {
                this.logRecorder.warn("获取下一页失败", e)
                return false;
            })
        }
        if (this.isInfiniteScrollPage()) {
            return await this.loadMoreByWindowScroll().then(loaded => {
                if (loaded) {
                    logger.info("获取下一页成功")
                }
                return loaded;
            }).catch(e => {
                this.logRecorder.warn("获取下一页失败", e)
                return false;
            })
        }
        if (this.curUrl.includes("job-recommend")) {
            return await this.loadMoreByWindowScroll().then(loaded => {
                if (loaded) {
                    logger.info("获取下一页成功")
                }
                return loaded;
            }).catch(e => {
                this.logRecorder.warn("获取下一页失败", e)
                return false;
            })
        }
        // 点击下一页
        const nextPageBtn = document.querySelector<any>(".ui-icon-arrow-right");
        if (!nextPageBtn || nextPageBtn.parentElement.className === "disabled") {
            return false;
        }
        nextPageBtn.click();
        return true;
    }


    async matchJob(jobDetail: BossJobDetail) {
        // 标记为已处理
        jobDetail.processed = true
        const jobTitle = this.getJobKey(jobDetail)
        // 已经沟通过
        if (jobDetail.contact) {
            throw new NotMatchException(jobTitle, jobDetail.contact, '已经沟通过')
        }
        // 过滤猎头
        if (userStore.user.preference.fhE && jobDetail.goldHunter === 1) {
            throw new NotMatchException(jobTitle, jobDetail.goldHunter, '过滤猎头')
        }
        // 仅投递在线boss
        if (userStore.user.preference.polE && !jobDetail.bossOnline) {
            throw new NotMatchException(jobTitle, jobDetail.bossOnline, '仅投递在线boss')
        }

        // 不满足配置公司名
        let companyNameInclude: string[] = userStore.user.preference.cni;
        if (userStore.user.preference.cniE && !Tools.fuzzyMatch(companyNameInclude, jobDetail.brandName, true)) {
            throw new NotMatchException(jobTitle, jobDetail.brandName, '不满足配置公司名')
        }

        // 满足排除公司名
        let companyNameExclude: string[] = userStore.user.preference.cne;
        if (userStore.user.preference.cneE && Tools.fuzzyMatch(companyNameExclude, jobDetail.brandName, false)) {
            throw new NotMatchException(jobTitle, jobDetail.brandName, '满足排除公司名')
        }

        // 不满足配置工作名
        let jobNameInclude: string[] = userStore.user.preference.jni;
        if (userStore.user.preference.jniE && !Tools.fuzzyMatch(jobNameInclude, jobDetail.jobName, true)) {
            throw new NotMatchException(jobTitle, jobDetail.jobName, '不满足配置工作名')
        }

        // 满足排除工作名
        let jobNameExclude: string[] = userStore.user.preference.jne;
        if (userStore.user.preference.jneE && Tools.fuzzyMatch(jobNameExclude, jobDetail.jobName, false)) {
            throw new NotMatchException(jobTitle, jobDetail.jobName, '满足排除工作名')
        }

        // 不满足薪资范围 薪资类型（实习中的天维度）不需要特殊处理
        let pageSalaryRange = jobDetail.salaryDesc.split(".")[0];
        if (userStore.user.preference.srE && !Tools.isRangeOverlap(userStore.user.preference.sr, pageSalaryRange)) {
            throw new NotMatchException(jobTitle, pageSalaryRange, '不满足薪资范围')
        }

        // 公司规模
        let pageCompanyScaleRange = userStore.user.preference.csr;
        if (userStore.user.preference.csrE && !Tools.isRangeOverlap(pageCompanyScaleRange, jobDetail.brandScaleName)) {
            throw new NotMatchException(jobTitle, jobDetail.brandScaleName, '不满足公司规模范围')
        }

        // 通过接口获取工作详情扩展信息
        let jobDetailExt = await this.obtainBossJobDetailExt(jobDetail);
        logger.debug(`获取工作【${jobTitle}】详情扩展信息用于过滤 `, jobDetail)

        //  活跃度
        let activeTimeDesc = jobDetailExt.activeTimeDesc;
        if (!this.bossIsActive(activeTimeDesc)) {
            throw new NotMatchException(jobTitle, activeTimeDesc, '不满足活跃度检查')
        }

        // 工作内容排除
        let jobContent = jobDetailExt.postDescription;
        let jobContentExclude: string[] = userStore.user.preference.jce;
        if (userStore.user.preference.jceE && Tools.fuzzyMatch(jobContentExclude, jobContent, false)) {
            throw new NotMatchException(jobTitle, jobContent, '满足排除工作内容')
        }

        // 工作内容包含
        let jobContentInclude: string[] = userStore.user.preference.jci;
        if (userStore.user.preference.jciE && !Tools.fuzzyMatch(jobContentInclude, jobContent, true)) {
            throw new NotMatchException(jobTitle, jobContent, '不满足工作内容')
        }

        // ai过滤
        if (userStore.user.preference.afE && userStore.user.preference.af) {
            let filterResp = await AiPower.filter(userStore.user.preference.af, JSON.stringify(this.unpackBaseInfo(jobDetail)), JSON.stringify(this.unpackExtInfo(jobDetailExt)));
            let filterResult = filterResp ? filterResp?.data?.data : null;
            if (filterResult && filterResult?.filter) {
                throw new NotMatchException(jobTitle, filterResult.reason, 'AI过滤')
            }
        }

        // 重新检测投递（页面点击投递后，页面数据不会变，所有标签中获取到的是否沟通过有可能是旧的，需要重新校验）
        if (this.isCommunication(jobDetailExt)) {
            throw new NotMatchException(jobTitle, jobDetailExt.friendStatus, '已经沟通过')
        }

        return true;
    }

    unpackBaseInfo(jobDetail: BossJobDetail): {} {
        return {
            jobName: jobDetail.jobName,
            salaryDesc: jobDetail.salaryDesc,
            jobLabels: jobDetail.jobLabels,
            skills: jobDetail.skills,
            jobExperience: jobDetail.jobExperience,
            jobDegree: jobDetail.jobDegree,
            cityName: jobDetail.cityName,
            areaDistrict: jobDetail.areaDistrict,
            businessDistrict: jobDetail.businessDistrict,
            brandName: jobDetail.brandName,
            brandStageName: jobDetail.brandStageName,
            brandIndustry: jobDetail.brandIndustry,
            brandScaleName: jobDetail.brandScaleName,
            welfareList: jobDetail.welfareList,
        }
    }
    unpackExtInfo(jobDetailExt: any): {} {
        return {
            postDescription: jobDetailExt.postDescription,
            address: jobDetailExt.address,
            activeTimeDesc: jobDetailExt.activeTimeDesc
        }
    }

    pausePush() {
        this.pushStatus = PushStatus.PAUSE
    }

    getJobKey(jobDetail: BossJobDetail): string {
        return jobDetail.jobName + "-" + jobDetail.cityName + jobDetail.areaDistrict + jobDetail.businessDistrict;
    }


    isLimit(jobDetail: JobDetail): { limit: boolean; msg: string } {
        return {
            limit: TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_LIMIT, false),
            msg: "Boss投递限制每天100次"
        }
    }

    async doPush(jobDetail: BossJobDetail, errorMsg = '', retries = 3): Promise<any> {
        const jobTitle = this.getJobKey(jobDetail)

        if (retries === 3) {
            logger.debug("正在投递：" + jobTitle)
        }

        // 重试结束；抛出异常结束
        if (retries === 0) {
            throw new PushReqException(jobTitle, errorMsg || "投递请求重试多次失败")
        }

        // 投递请求url
        let publishUrl = `https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId=` +
            `${jobDetail.securityId}&jobId=${jobDetail.encryptJobId}&lid=${jobDetail.lid}`

        const token = Tools.getCookieValue("bst");
        if (!token) {
            throw new PushReqException(jobTitle, "未获取到zp-token，请确认已登录 Boss 直聘")
        }

        let pushResp: any = {code: PushResultStatus.NOT_START, message: ""};
        try {
            // 避免频繁，每次投递前延时
            await Tools.sleep(userStore.user.preference.pi * 1000)
            pushResp = await axiosOriginal.post(publishUrl, null, {headers: {"Zp_token": token}});
        } catch (error: any) {
            const retryMessage = this.getErrorMessage(error);
            // 重试投递
            logger.debug(`工作【${jobTitle}】投递失败; 正在等待重试; 原因：${retryMessage}`)
            await Tools.sleep(800);
            return await this.doPush(jobDetail, retryMessage, retries - 1);
        }

        const responseData = pushResp?.data ?? {
            code: PushResultStatus.FAIL,
            message: "投递接口未返回数据"
        };
        const remindContent = responseData?.zpData?.bizData?.chatRemindDialog?.content;
        const remindMessage = remindContent == null ? "" : String(remindContent);

        if (responseData.code === PushResultStatus.FAIL && remindMessage) {
            // 过滤开聊提示，实际投递成功
            if (remindMessage.includes("您今天已与120位BOSS沟通")) {
                logger.debug(`当天已投递超过120次 工作【${jobTitle}】已修正为投递成功`)
                return {
                    code: PushResultStatus.SUCCESS,
                    message: "Success"
                }
            }
            // 某些条件不满足，boss限制投递，无需重试，在结果处理器中处理
            return {
                code: PushResultStatus.FAIL,
                message: remindMessage
            }
        }
        // 避免频繁
        await Tools.sleep(800);
        return responseData;
    }

    private bossDataCache: Map<string, any> = new Map();

    private async requestBossDataByCache(jobDetail: BossJobDetail): Promise<any> {
        let cacheKey = `${jobDetail.encryptBossId}-${jobDetail.securityId}`;

        // 先检查缓存中是否有数据
        if (this.bossDataCache.has(cacheKey)) {
            return this.bossDataCache.get(cacheKey);
        }

        // 缓存请求结果
        const result = await this.requestBossData(jobDetail);
        this.bossDataCache.set(cacheKey, result);
        return result;
    }

    async requestBossData(jobDetail: BossJobDetail, errorMsg: string = "", retries = 3): Promise<any> {
        let jobTitle = this.getJobKey(jobDetail);

        if (retries === 0) {
            throw new FetchJobBossFailExp(jobTitle, errorMsg || "获取boss数据重试多次失败");
        }
        const url = "https://www.zhipin.com/wapi/zpchat/geek/getBossData";
        const token = Tools.getCookieValue("bst");
        if (!token) {
            throw new FetchJobBossFailExp(jobTitle, "未获取到zp-token");
        }

        const data = new FormData();
        data.append("bossId", jobDetail.encryptBossId);
        data.append("securityId", jobDetail.securityId);
        data.append("bossSrc", "0");

        let resp: any;
        try {
            resp = await axiosOriginal({url, data: data, method: "POST", headers: {Zp_token: token}});
        } catch (e: any) {
            return this.requestBossData(jobDetail, e.message, retries - 1);
        }

        if (resp.data.code !== 0) {
            throw new FetchJobBossFailExp(jobTitle, resp.data.message);
        }
        return resp.data.zpData
    }

    private startPostPushQueueWorker(): void {
        if (this.postPushQueueWorkerTimer !== null) {
            return;
        }
        window.addEventListener('ai-job:chat-channel-ready', () => this.processPostPushQueue().then());
        this.postPushQueueWorkerTimer = window.setInterval(() => {
            this.processPostPushQueue().then();
        }, POST_PUSH_QUEUE_WORKER_INTERVAL_MS);
        this.processPostPushQueue().then();
    }

    private async processPostPushQueue(): Promise<void> {
        if (this.postPushQueueProcessing) {
            return;
        }

        const queueSnapshot = this.readPostPushQueue();
        const pendingItems = Object.values(queueSnapshot)
            .filter(item => item.status === 'pending' && item.retryCount < POST_PUSH_QUEUE_MAX_RETRY);
        if (pendingItems.length === 0) {
            return;
        }

        this.postPushQueueProcessing = true;
        try {
            if (!await this.ensureMessageChannel()) {
                logger.debug(`投递后置发送队列等待聊天通道就绪，待发送 ${pendingItems.length} 条`)
                return;
            }

            for (const pendingItem of pendingItems) {
                let queue = this.readPostPushQueue();
                const item = queue[pendingItem.id];
                if (!item || item.status !== 'pending') {
                    continue;
                }

                item.status = 'processing';
                item.updatedAt = Date.now();
                queue[item.id] = item;
                this.writePostPushQueue(queue);

                try {
                    const bossId = await this.sendPostPushQueueItem(item);
                    queue = this.readPostPushQueue();
                    if (queue[item.id]) {
                        queue[item.id].status = 'success';
                        queue[item.id].job.bossId = bossId;
                        queue[item.id].updatedAt = Date.now();
                        queue[item.id].lastError = '';
                        this.writePostPushQueue(queue);
                    }
                    this.logRecorder.info(`工作【${item.job.jobTitle}】${this.getPostPushActionName(item.action)}补发成功`)
                } catch (error) {
                    const errorMessage = this.getErrorMessage(error);
                    queue = this.readPostPushQueue();
                    if (queue[item.id]) {
                        const nextRetryCount = queue[item.id].retryCount + 1;
                        queue[item.id].retryCount = nextRetryCount;
                        queue[item.id].status = nextRetryCount >= POST_PUSH_QUEUE_MAX_RETRY ? 'failed' : 'pending';
                        queue[item.id].updatedAt = Date.now();
                        queue[item.id].lastError = errorMessage;
                        this.writePostPushQueue(queue);
                    }
                    this.logRecorder.warn(`工作【${item.job.jobTitle}】${this.getPostPushActionName(item.action)}补发失败 原因：${errorMessage}`)
                }
            }
        } finally {
            this.postPushQueueProcessing = false;
        }
    }

    private async requestPostPushBossId(item: PostPushQueueItem, errorMsg = '', retries = 3): Promise<string> {
        if (item.job.bossId) {
            return item.job.bossId;
        }
        if (retries === 0) {
            throw new Error(errorMsg || "获取boss数据重试多次失败");
        }

        const token = Tools.getCookieValue("bst");
        if (!token) {
            throw new Error("未获取到zp-token");
        }

        const data = new FormData();
        data.append("bossId", item.job.encryptBossId);
        data.append("securityId", item.job.securityId);
        data.append("bossSrc", "0");

        try {
            const resp: any = await axiosOriginal({
                url: "https://www.zhipin.com/wapi/zpchat/geek/getBossData",
                data,
                method: "POST",
                headers: {Zp_token: token}
            });
            if (resp.data.code !== 0) {
                throw new Error(resp.data.message || "获取boss数据失败");
            }
            const bossId = resp.data?.zpData?.data?.bossId;
            if (!bossId) {
                throw new Error("获取bossId失败");
            }
            return bossId.toString();
        } catch (error) {
            return this.requestPostPushBossId(item, this.getErrorMessage(error), retries - 1);
        }
    }

    private async sendPostPushQueueItem(item: PostPushQueueItem): Promise<string> {
        const fromUid = Tools.window?._PAGE?.uid;
        if (!fromUid) {
            throw new Error("未获取到当前用户uid");
        }

        const bossId = await this.requestPostPushBossId(item);
        const isImageAction = item.action === 'image';
        if (isImageAction && !item.payload.image) {
            throw new Error("自定义图片配置为空");
        }
        if (!isImageAction && !item.payload.greeting) {
            throw new Error("自定义招呼语为空");
        }

        const message = new Message({
            form_uid: fromUid.toString(),
            to_uid: bossId,
            to_name: item.job.encryptBossId,
            content: item.payload.greeting || "",
            image: isImageAction ? item.payload.image : undefined,
        });
        await this.sendMessageWithRetry(message, item.job.jobTitle, `补发${this.getPostPushActionName(item.action)}`, 3);
        return bossId;
    }


    async pushAfterHandler(pushResult: PushResult, jobDetail: BossJobDetail): Promise<any> {
        const jobTitle = this.getJobKey(jobDetail)

        if (pushResult.message === 'Success' && pushResult.code === 0) {
            pushResultCounter.successIncr()
            this.logRecorder.info(`工作【${jobTitle}】 投递成功`)
            this.enqueuePostPushActions(jobDetail);

            // 标记为已沟通，在推荐页面中下一页会获取之前的数据，所以需要标记为已沟通
            jobDetail.contact = true
            return jobDetail
        }

        const resultMessage = pushResult?.message || "投递失败，接口未返回失败原因";
        if (resultMessage.includes("今日沟通人数已达上限")) {
            throw new PublishLimitExp(resultMessage)
        }
        throw new PushReqException(jobTitle, resultMessage)
    }

    /**
     * 投递后发送自定义消息
     */
    async pushAfterSendMsg(jobDetail: BossJobDetail) {
        const jobTitle = this.getJobKey(jobDetail);

        if (!userStore.user.preference.cgE) {
            this.logRecorder.info(`工作【${jobTitle}】未开启自定义招呼语，跳过发送`)
            return;
        }
        if (this._pushMock) {
            this.logRecorder.info(`工作【${jobTitle}】当前为模拟投递，跳过发送自定义招呼语`)
            return;
        }

        let customGreeting = userStore.user.preference.cg;
        if (!customGreeting) {
            this.logRecorder.info(`工作【${jobTitle}】自定义招呼语为空，跳过发送`)
            return;
        }

        let bossData = await this.requestBossDataByCache(jobDetail);

        // 发送websocket消息
        let message = new Message({
            form_uid: Tools.window._PAGE.uid.toString(),
            to_uid: bossData.data.bossId.toString(),
            to_name: jobDetail.encryptBossId,
            content: customGreeting,
            image: undefined,
        });
        await this.sendMessageWithRetry(message, jobTitle, "发送自定义招呼语")
    }

    /**
     * 投递后发送自定义图片
     */
    async pushAfterSendImage(jobDetail: BossJobDetail) {
        const jobTitle = this.getJobKey(jobDetail);

        if (!userStore.user.preference.cIE) {
            this.logRecorder.info(`工作【${jobTitle}】未开启自定义图片，跳过发送`)
            return;
        }
        if (this._pushMock) {
            this.logRecorder.info(`工作【${jobTitle}】当前为模拟投递，跳过发送自定义图片`)
            return;
        }

        let bossData = await this.requestBossDataByCache(jobDetail);
        let customerImageSet = userStore.user.preference.cI;
        if (!customerImageSet) {
            this.logRecorder.info(`工作【${jobTitle}】自定义图片配置为空，跳过发送`)
            return;
        }
        const [originImage, tinyImage] = customerImageSet.split("===");
        if (!originImage || !tinyImage) {
            this.logRecorder.warn(`工作【${jobTitle}】自定义图片配置异常，跳过发送`)
            return;
        }

        let message = new Message({
            form_uid: Tools.window._PAGE.uid.toString(),
            to_uid: bossData.data.bossId.toString(),
            to_name: jobDetail.encryptBossId,
            content: "",
            image: {
                originImage,
                tinyImage,
            },
        });
        await this.sendMessageWithRetry(message, jobTitle, "发送自定义图片")
    }

    private hasMessageChannel(): boolean {
        if (Tools.window.ChatWebsocket?.send || Tools.window.ChatWebsocketImage?.send) {
            return true;
        }
        try {
            return !!Tools.window.GeekChatCore?.getInstance?.()?.getClient?.()?.client?.send;
        } catch (_) {
            return false;
        }
    }

    private async ensureMessageChannel(): Promise<boolean> {
        if (this.hasMessageChannel()) {
            return true;
        }
        if (!Tools.window.AiJobEnsureChatWebsocket) {
            return false;
        }
        try {
            await Tools.window.AiJobEnsureChatWebsocket();
        } catch (error) {
            logger.warn("初始化聊天发送通道失败", error);
        }
        return this.hasMessageChannel();
    }

    private async sendMessageWithRetry(message: Message, jobTitle: string, actionName: string, retries = 8): Promise<void> {
        for (let currentRetry = 1; currentRetry <= retries; currentRetry++) {
            if (!await this.ensureMessageChannel()) {
                if (currentRetry < retries) {
                    this.logRecorder.warn(`工作【${jobTitle}】${actionName}聊天通道未就绪，第 ${currentRetry}/${retries} 次，1秒后重试`)
                    await Tools.sleep(1000);
                    continue;
                }
                break;
            }

            if (message.send()) {
                this.logRecorder.info(`工作【${jobTitle}】${actionName}成功`)
                return;
            }

            if (currentRetry < retries) {
                this.logRecorder.warn(`工作【${jobTitle}】${actionName}发送异常，第 ${currentRetry}/${retries} 次，1秒后重试`)
                await Tools.sleep(1000);
            }
        }

        throw new Error(`${actionName}失败，聊天通道未就绪或发送异常`)
    }

    private getErrorMessage(error: any): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === "string") {
            return error;
        }
        try {
            return JSON.stringify(error);
        } catch (_) {
            return String(error);
        }
    }

    pushPreHandler(jobDetail: JobDetail): JobDetail {
        return jobDetail;
    }

    async obtainBossJobDetailExt(jobDetail: BossJobDetail, message = '', retries = 3): Promise<any> {

        if (retries === 0) {
            logger.warn(`获取工作详情扩展信息异常,用于活跃度过滤以及工作内容过滤; 原因：${message}`)
            throw new NotMatchException(this.getJobKey(jobDetail), message, "获取工作详情扩展信息异常")
        }
        let params = `lid=${jobDetail.lid}&securityId=${jobDetail.securityId}&sessionId=`
        try {
            let resp = await axiosOriginal.get("https://www.zhipin.com/wapi/zpgeek/job/card.json?" + params, {timeout: 5000})
            return resp.data.zpData.jobCard
        } catch (error: any) {
            logger.debug("获取详情页异常正在重试:", error)
            return this.obtainBossJobDetailExt(jobDetail, error.message, retries - 1)
        }
    }

    bossIsActive(activeText: string) {
        return !(activeText.includes("月") || activeText.includes("年") || activeText.includes("周"));
    }

    isCommunication(jobCardJson: any) {
        return jobCardJson?.friendStatus === 1;
    }


}

const platformList: any[] = [BossPlatform]


class PlatformFactory {
    public static getInstance(url: string): Platform {
        for (const PlatformClass of platformList) {
            const platformInstance = new PlatformClass(url) as Platform;
            if (platformInstance.urlList.some(platformUrl => url.includes(platformUrl))) {
                // 计数器赋值
                pushResultCounter = pushResultCount();
                userStore = UserStore();
                userStore.platformType = platformInstance.getPlatformType();
                userRemoteLoad()
                return platformInstance;
            }
        }
        throw new PlatformError(PlatformTypeEnum.UnKnow, "错误的平台");
    }
}


export default PlatformFactory
