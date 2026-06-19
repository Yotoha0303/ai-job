<template>
    <!-- 服务器配置面板 -->
    <el-card class="server-config-card" shadow="hover">
        <div class="server-config-container">
            <div class="server-status">
                <el-badge :value="serverStore.isOnline ? '在线' : '离线'" :type="serverStore.isOnline ? 'success' : 'danger'">
                    <el-text size="large" strong>服务器状态</el-text>
                </el-badge>
            </div>
            <div class="server-input">
                <el-input v-model="tempServerUrl" placeholder="请输入服务器地址" class="custom-server-input">
                    <template #prepend>服务器地址</template>
                    <template #append>
                        <el-button-group class="btn-group">
                            <el-button @click="handleUpdateServer" class="test-btn">连接测试</el-button>
                            <el-tooltip content="重置为默认地址" placement="top">
                                <el-button @click="handleResetServer" class="reset-btn">
                                    <el-icon><RefreshRight /></el-icon>
                                </el-button>
                            </el-tooltip>
                        </el-button-group>
                    </template>
                </el-input>
            </div>
            <div class="server-mode-tip">
                <el-tag :type="serverStore.isOnline ? 'success' : 'warning'" effect="dark">
                    {{ serverStore.isOnline ? '在线模式：功能全开' : '本地模式：AI功能受限' }}
                </el-tag>
            </div>
        </div>
    </el-card>

    <br>

    <el-text size="large" class="mx-1" type="primary">投递成功：{{
            pushResultCounter.successCount
        }}&nbsp;&nbsp;&nbsp;
    </el-text>
    <el-text size="large" class="mx-1" type="danger"> 投递失败：{{
            pushResultCounter.failCount
        }}&nbsp;&nbsp;&nbsp;
    </el-text>
    <el-text size="large" class="mx-1"> 单次投递限制数量：</el-text>
    <el-input-number v-model="selfDefPushCountLimit" :min="-1" :max="100"
                     @change="selfDefPushCountLimitChange"/>
    <span v-if="!isProdEnv()">
        &nbsp;&nbsp;&nbsp;MOCK投递&nbsp; <el-switch v-model="mockPush"/>
    </span>
    <br>
    <br>

    <div class="main-actions">
        <div class="primary-actions-row">
            <div class="primary-actions">
                <el-tooltip effect="dark" raw-content content="
                在Boss中更新了附件简历后请重新导入<p/>
                - 仅用于AI坐席定制化回复
                " placement="bottom">
                    <el-button class="action-button" :icon="Upload as any" type="primary" @click="handlerImport"
                               :disabled="!serverStore.isOnline"
                               :loading="importResumeLoading">
                        <span class="action-label">导入简历</span>
                    </el-button>
                </el-tooltip>

                <el-tooltip effect="dark" raw-content content="
                先通过Boss的筛选功能圈选你的意向岗位<p/><span style='color:red;'>在【偏好设置-投递设置】中选择</span><br/>您的投递偏好，用于精准投递岗位
                " placement="bottom">
                    <el-button class="action-button" :icon="Promotion as any" :type="pushBtnType" @click="handlerPush"
                               :disabled="autoSearchRunning">
                        <span class="action-label">{{ pushBtnText }}</span>
                    </el-button>
                </el-tooltip>

                <el-tooltip effect="dark" raw-content content="
                自动搜索会按照页面关键词库从第一条开始依次搜索岗位<p/>
                - 每次启动都会重新从第一行开始。<br/>
                - 每个关键词搜索结果停留5分钟后再切换下一条。<br/>
                - 自动搜索运行期间每8分钟刷新一次页面。<br/>
                - 倒计时结束时如果自动投递未完成，会顺延2分钟。<br/>
                - 会保留当前BOSS搜索页已有筛选条件，只替换关键词。<br/>
                - 搜索过程中可点击停止搜索中断。<br/>
                " placement="bottom">
                    <el-button class="action-button auto-search-button" :icon="Collection as any" :type="autoSearchBtnType"
                               @click="handlerAutoSearch"
                               :disabled="(autoSearchRunning && autoSearchMode !== 'search') || (!autoSearchRunning && pushStatus === PushStatus.PUSHING) || autoSearchKeywords.length === 0">
                        <span class="action-label">{{ autoSearchBtnText }}</span>
                    </el-button>
                </el-tooltip>

                <el-tooltip effect="dark" raw-content content="
                快速投递会按照页面关键词库从第一条开始依次搜索岗位<p/>
                - 进入每个关键词结果页后自动投递。<br/>
                - 当前关键词自动投递完成后，立即搜索下一条关键词。<br/>
                - 如果自动投递仍在运行，会等待投递完成。<br/>
                - 会保留当前BOSS搜索页已有筛选条件，只替换关键词。<br/>
                - 运行期间可点击停止快投中断。<br/>
                " placement="bottom">
                    <el-button class="action-button quick-push-button" :icon="Promotion as any" :type="quickPushBtnType"
                               @click="handlerQuickPush"
                               :disabled="(autoSearchRunning && autoSearchMode !== 'quickPush') || (!autoSearchRunning && pushStatus === PushStatus.PUSHING) || autoSearchKeywords.length === 0">
                        <span class="action-label">{{ quickPushBtnText }}</span>
                    </el-button>
                </el-tooltip>
            </div>

            <div class="ai-seat-action">
                <el-tooltip effect="dark" raw-content content="
                AI坐席：<span style='color:red;'>支持试用，点击开关开启试用</span><br/>
                - 自动响应hr的消息,根据您的简历信息进行定制化回答。<br/>
                - 高意向职位邮件通知，快速筛选出最合适的职位。<br/>
                - 快捷发送简历，交换 wx、联系方式。<br/>
                - hr拒绝挽留，不放过每一个机会。<br/>
                " placement="bottom">
                    <el-button class="action-button" :icon="Service as any" color="#626aef" :disabled="!serverStore.isOnline">
                        <span class="action-label ai-seat-label">
                            <span>AI坐席</span>
                            <el-switch active-text="开" inactive-text="关" inline-prompt
                                       style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
                                       v-model="userStore.user.aiSeatStatus"
                                       :disabled="!serverStore.isOnline"
                                       @change="handlerAISeatStatusChange"/>
                        </span>
                    </el-button>
                </el-tooltip>
            </div>
        </div>

        <div class="config-actions-row">
            <div class="search-keyword-controls" aria-label="自动搜索词库设置">
                <span class="config-section-title">自动搜索词库</span>
                <el-tooltip effect="dark" content="维护自动搜索和快速投递共用的岗位关键词，保存到当前浏览器。" placement="bottom">
                    <el-button class="action-button keyword-settings-button"
                               :icon="Collection as any"
                               @click="openAutoSearchKeywordDialog"
                               :disabled="autoSearchRunning">
                        <span class="action-label">搜索关键词</span>
                    </el-button>
                </el-tooltip>
            </div>

            <div class="search-param-controls" aria-label="搜索参数设置">
                <span class="config-section-title">搜索参数</span>
                <el-tooltip effect="dark" content="沿用当前BOSS搜索页的城市、薪资、经验等筛选条件，只替换搜索关键词。" placement="bottom">
                    <el-checkbox v-model="autoSearchReuseCurrentSearchParams"
                                 :disabled="autoSearchRunning">沿用BOSS筛选</el-checkbox>
                </el-tooltip>
                <el-tooltip effect="dark" content="维护搜索页地址和默认 URL 参数，保存到当前浏览器。" placement="bottom">
                    <el-button class="action-button search-param-button"
                               :icon="Collection as any"
                               @click="openAutoSearchConfigDialog"
                               :disabled="autoSearchRunning">
                        <span class="action-label">参数设置</span>
                    </el-button>
                </el-tooltip>
            </div>

            <div class="fuzzy-push-controls" aria-label="模糊快投设置">
                <span class="config-section-title fuzzy-section-title">模糊快投</span>
                <label class="fuzzy-field fuzzy-rule-select-field">
                    <span class="fuzzy-field-label">投递规则</span>
                    <el-select v-model="selectedFuzzyPushRuleId"
                               class="fuzzy-rule-select"
                               placeholder="请先配置模糊词库"
                               :disabled="autoSearchRunning && autoSearchMode !== 'fuzzyPush'">
                        <el-option v-for="rule in enabledFuzzyPushRules"
                                   :key="rule.id"
                                   :label="rule.seedKeyword"
                                   :value="rule.id"/>
                    </el-select>
                </label>
                <label class="fuzzy-field fuzzy-count-field">
                    <span class="fuzzy-field-label">本轮最多投递</span>
                    <el-input-number v-model="fuzzyPushMaxCount"
                                     class="fuzzy-count-input"
                                     :min="1"
                                     :max="100"
                                     size="small"
                                     :disabled="autoSearchRunning && autoSearchMode !== 'fuzzyPush'"/>
                </label>
                <div class="fuzzy-options">
                    <el-tooltip effect="dark" content="开启后，模糊快投仍会经过偏好设置里的AI语义匹配过滤。" placement="bottom">
                        <el-checkbox v-model="userStore.user.preference.afE"
                                     :disabled="autoSearchRunning && autoSearchMode !== 'fuzzyPush'">AI匹配过滤</el-checkbox>
                    </el-tooltip>
                </div>
                <el-tooltip effect="dark" raw-content :content="`
                必须先在模糊词库配置并启用规则，才能开始模糊快投。<br/>
                当前规则：${selectedFuzzyPushRule ? selectedFuzzyPushRule.seedKeyword : '未选择规则'}<br/>
                当前扩展：${fuzzyPushKeywordListPreview.length ? fuzzyPushKeywordListPreview.join('、') : '请先配置规则'}<br/>
                本轮最多投递：${fuzzyPushMaxCount} 个岗位，并按扩展关键词分摊单次投递上限。<br/>
                投递仍复用现有岗位偏好、薪资、公司、内容和AI匹配过滤规则。
                `" placement="bottom">
                    <el-button class="action-button fuzzy-push-button"
                               :icon="Promotion as any"
                               :type="fuzzyPushBtnType"
                               @click="handlerFuzzyPush"
                               :disabled="(autoSearchRunning && autoSearchMode !== 'fuzzyPush') || (!autoSearchRunning && pushStatus === PushStatus.PUSHING) || !selectedFuzzyPushRule || fuzzyPushKeywordListPreview.length === 0">
                        <span class="action-label">{{ fuzzyPushBtnText }}</span>
                    </el-button>
                </el-tooltip>
                <el-tooltip effect="dark" content="维护种子词和扩展搜索关键词，保存到当前浏览器。" placement="bottom">
                    <el-button class="action-button fuzzy-rule-button"
                               :icon="Collection as any"
                               @click="openFuzzyPushRuleDialog"
                               :disabled="autoSearchRunning">
                        <span class="action-label">模糊词库</span>
                    </el-button>
                </el-tooltip>
            </div>
        </div>

        <el-tag v-show="autoSearchRunning" class="auto-search-tag" type="info" effect="plain">
            {{ autoSearchProgressText }}
        </el-tag>

        <!-- <el-button type="info" @click="handlerScrollToBottomThenTop" :loading="scrollBottomLoading">
            <span class="action-label">一键到达页面底部</span>
        </el-button> -->

        <el-link class="demo-link" type="primary" href="https://www.bilibili.com/video/BV1y6PjesEvi"
                 target="_blank">点击查看AI坐席效果演示
        </el-link>
    </div>

    <el-dialog v-model="autoSearchKeywordDialogVisible"
               title="自动搜索关键词设置"
               width="720px"
               class="keyword-settings-dialog"
               append-to-body>
        <el-form label-position="top">
            <el-form-item label="岗位关键词">
                <el-input v-model="autoSearchKeywordText"
                          type="textarea"
                          :rows="10"
                          placeholder="每行一个关键词，也可以用逗号分隔，如 Go后端、Golang、服务端开发"/>
            </el-form-item>
            <div class="keyword-settings-summary">
                <el-tag type="info" effect="plain">有效关键词 {{ autoSearchKeywordDraftList.length }} 个</el-tag>
                <span class="keyword-settings-hint">自动搜索和快速投递会按保存后的顺序执行。</span>
            </div>
            <div class="keyword-settings-actions">
                <el-button type="primary" @click="saveAutoSearchKeywordDialog">保存关键词</el-button>
                <el-button @click="resetAutoSearchKeywordDialog">恢复默认</el-button>
            </div>
        </el-form>
        <el-divider/>
        <div class="keyword-preview-list">
            <el-tag v-for="keyword in autoSearchKeywordDraftList"
                    :key="keyword"
                    class="keyword-preview-tag"
                    effect="plain">
                {{ keyword }}
            </el-tag>
        </div>
    </el-dialog>

    <el-dialog v-model="autoSearchConfigDialogVisible"
               title="搜索参数设置"
               width="720px"
               class="search-param-dialog"
               append-to-body>
        <el-form label-position="top">
            <el-form-item label="搜索页地址">
                <el-input v-model="autoSearchConfigForm.baseUrl"
                          placeholder="https://www.zhipin.com/web/geek/jobs"/>
            </el-form-item>
            <el-form-item label="默认 URL 参数">
                <el-input v-model="autoSearchConfigForm.defaultParamsText"
                          type="textarea"
                          :rows="6"
                          placeholder="每行一个参数，例如：&#10;city=101280600&#10;experience=101,103,104"/>
            </el-form-item>
            <el-form-item label="筛选复用">
                <el-switch v-model="autoSearchConfigForm.reuseCurrentSearchParams"
                           active-text="沿用当前BOSS筛选"
                           inactive-text="使用默认参数"/>
            </el-form-item>
            <div class="search-param-actions">
                <el-button type="primary" @click="saveAutoSearchConfigDialog">保存参数</el-button>
                <el-button @click="importAutoSearchConfigFromCurrentPage">从当前页面导入</el-button>
                <el-button @click="resetAutoSearchConfigDialog">恢复默认</el-button>
            </div>
        </el-form>
        <el-divider/>
        <div class="search-param-preview">
            <el-tag type="info" effect="plain">默认参数 {{ autoSearchDefaultParamCount }} 个</el-tag>
            <span class="keyword-settings-hint">保存后自动搜索、快速投递和模糊快投都会使用这组搜索参数。</span>
        </div>
    </el-dialog>

    <el-dialog v-model="fuzzyPushRuleDialogVisible"
               title="模糊快投词库设置"
               width="760px"
               class="fuzzy-rule-dialog"
               append-to-body>
        <el-form class="fuzzy-rule-form" label-position="top">
            <div class="fuzzy-rule-form-grid">
                <el-form-item label="种子关键词">
                    <el-input v-model="fuzzyPushRuleForm.seedKeyword"
                              placeholder="如 Go"
                              clearable/>
                </el-form-item>
                <el-form-item label="状态">
                    <el-switch v-model="fuzzyPushRuleForm.enabled"
                               active-text="启用"
                               inactive-text="停用"
                               inline-prompt/>
                </el-form-item>
            </div>
            <el-form-item label="扩展搜索关键词">
                <el-input v-model="fuzzyPushRuleForm.expandedKeywordsText"
                          type="textarea"
                          :rows="4"
                          placeholder="每行一个或用逗号分隔，如 Go后端、Golang、服务端开发"/>
            </el-form-item>
            <div class="fuzzy-rule-form-actions">
                <el-button type="primary" @click="saveFuzzyPushRuleForm">
                    {{ fuzzyPushRuleEditingId ? '保存规则' : '新增规则' }}
                </el-button>
                <el-button @click="resetFuzzyPushRuleForm">清空</el-button>
                <el-button @click="resetFuzzyPushRulesToDefaults">恢复默认</el-button>
            </div>
        </el-form>
        <el-divider/>
        <div class="fuzzy-rule-table-header">
            <span>已保存规则</span>
            <el-tag type="info" effect="plain">{{ fuzzyPushEnabledRuleCount }}/{{ fuzzyPushRules.length }} 启用</el-tag>
        </div>
        <el-table :data="fuzzyPushRules"
                  size="small"
                  max-height="300"
                  empty-text="暂无规则">
            <el-table-column label="状态" width="76">
                <template #default="{ row }">
                    <el-switch :model-value="row.enabled"
                               size="small"
                               @change="toggleFuzzyPushRule(row.id, Boolean($event))"/>
                </template>
            </el-table-column>
            <el-table-column prop="seedKeyword" label="种子词" width="132"/>
            <el-table-column label="扩展关键词">
                <template #default="{ row }">
                    <div class="fuzzy-rule-keywords">{{ row.expandedKeywords.join('、') }}</div>
                </template>
            </el-table-column>
            <el-table-column label="操作" width="112" fixed="right">
                <template #default="{ row }">
                    <el-button link type="primary" @click="editFuzzyPushRule(row)">编辑</el-button>
                    <el-button link type="danger" @click="removeFuzzyPushRule(row.id)">删除</el-button>
                </template>
            </el-table-column>
        </el-table>
    </el-dialog>

    <!-- 固定位置的停止投递按钮 -->
    <div v-show="pushStatus === PushStatus.PUSHING" class="fixed-stop-button">
        <!-- 实时投递运行记录显示 -->
        <div class="push-records-container">
            <div class="push-records-header">
                <span>实时投递记录</span>
            </div>
            <div class="push-records-content">
                <div v-for="(record, index) in latestPushRecords" :key="index" class="push-record-item">
                    <span class="record-time">{{ record.timestamp }}</span>
                    <span class="record-message" :class="getRecordLevelClass(record.level)">
                        {{ record.message }}
                    </span>
                </div>
                <div v-if="latestPushRecords.length === 0" class="no-records">
                    暂无投递记录
                </div>
            </div>
        </div>

        <el-button type="warning" size="large" @click="handlerFixedStopPush">
            <el-icon><CircleCloseFilled /></el-icon>
            停止投递
        </el-button>
    </div>

    <el-dialog v-model="aiSeatBuyVisible" :show-close="false" width="800">
        <template #header="{ close, titleId, titleClass }">
            <div class="my-header">
                <el-text size="large" style="font-size: 20px" type="info">产品列表</el-text>
                <el-button type="warning" @click="close">
                    <el-icon class="el-icon--left">
                        <CircleCloseFilled/>
                    </el-icon>
                    关闭
                </el-button>
            </div>

            <!--已购买产品-->
            <div v-show="buyProductList.length>0">
                <br>
                <h3>我的产品列表</h3>
                <br>
                <el-table v-show="buyProductList.length>0" :data="buyProductList" stripe style="width: 100%">
                    <el-table-column prop="productName" label="产品" width="180">
                        <template v-slot="{ row }">
                            <span :style="{ textDecoration: isExpired(row) ? 'line-through' : 'none' }">
                                {{ row.productName }}
                            </span>
                        </template>
                    </el-table-column>

                    <!-- 状态列 -->
                    <el-table-column label="状态" width="100">
                        <template v-slot="{ row }">
                            <span :style="{ color: isExpired(row) ? 'red' : 'green' }">
                                {{ isExpired(row) ? '过期' : '正常' }}
                            </span>
                        </template>
                    </el-table-column>

                    <el-table-column prop="powerList" label="能力" width="180">
                        <template v-slot="{ row }">
                            <div v-for="power in row.powerList" :key="power">
                                <el-tag effect="dark" :type="randomStyle()" size="small">{{ power }}</el-tag>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="periodOfValidityStartTime" label="有效期开始时间"/>
                    <el-table-column prop="periodOfValidityEndTime" label="有效期结束时间"/>
                </el-table>
                <br>
            </div>

            <!--            搜索展示不做条件限制-->
            <!--            <div v-show="!showOtherProduct" type="info">-->
            <div  type="info" style="margin-top: 10px">
                <el-button type="danger" :icon="Shop" @click="showOrderGroup">
                    更多产品
                </el-button>
                <el-input :suffix-icon="Wallet" v-model="promotionCode" style="margin-left: 10px;width: 240px" placeholder="请输入您的优惠码" />
                <el-link :icon="PriceTag" type="primary" style="margin-left: 30px;" target="_blank" href="https://www.bilibili.com/video/BV1HKAyebESp">点击获取优惠码(评论区)</el-link>

            </div>

            <el-empty v-show="!buyProductList?.length && !showOtherProduct" :image-size="50" description="购买产品为空，请点击更多产品查看"/>

            <!--订单组二维码-->
            <div v-if="showOtherProduct" v-loading="productListLoading">
                <br>
                <p>
                    <el-text class="mx-1" type="danger">定价说明：</el-text>
                    使用R1深度思考大模型时：首先，R1的价格更贵，深度思考的内容也会被记录token消耗。token消耗量巨大。同时由于boss的会话聊天机制，需要携带消息上下文调用。这也就意味着对话轮数越多，token消耗越多。按乘方的趋势增长。
                </p>
                <br>
                <div v-for="order in orderGroup" :key="order" style="display: flex" class="block"
                     :style="'width: '+1/orderGroup.length">
                    <!--订单标题-->
                    <div style="padding-top: 10px;min-width: 8%;">
                        <p class="demonstration">
                            <el-text size="large" type="primary">{{ order.title }}</el-text>
                        </p>
                        <p class="demonstration">
                            <el-text size="large" type="success">{{ order.validDays }}天</el-text>
                        </p>
                        <p class="demonstration">
                            <el-text size="large" type="danger">￥ {{ order.totalAmount }}</el-text>
                        </p>
                    </div>

                    <!--图片二维码-->
                    <el-image style="width: 100px; height: 100px" :src="'data:image/png;base64,'+order.qrCodeBase64"
                              fit="fill">
                        <template #error>
                            <div class="image-slot">加载订单二维码失败；请稍后刷新重试</div>
                        </template>
                    </el-image>

                    <div style="width: 80%">
                        <!--产品能力标签-->
                        <div>
                            提供能力:
                            <el-tag style="margin: 10px;" v-for="tag in order.tags" :key="tag" :type="randomStyle()"
                                    size="large" effect="light">{{ tag }}
                            </el-tag>
                        </div>
                        <!--产品推广描述-->
                        <div>
                            <span class="demonstration">{{ order.desc }}</span>
                        </div>
                    </div>
                </div>
            </div>

        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import axiosOriginal, { AxiosInstance } from "axios";
import { ElNotification } from "element-plus";
import { computed, h, inject, onMounted, onUnmounted, ref, Ref } from "vue";
import type { AutoSearchConfig } from "../../config/autoSearchConfig";
import type { FuzzyPushKeywordRule } from "../../config/fuzzyPushDefaultRules";
import { PushStatus } from "../../enums";
import logger from '../../logging';
import { LogRecorder } from "../../logging/record";
import { AbsPlatform } from "../../platform/platform";
import { Tools } from "../../platform/utils";
import {
    formatAutoSearchKeywords,
    isInvalidAutoSearchKeyword,
    readAutoSearchKeywords,
    resetAutoSearchKeywords,
    sanitizeAutoSearchKeywords,
    saveAutoSearchKeywords,
    splitAutoSearchKeywordText
} from "../../services/autoSearchKeywords";
import {
    AutoSearchRuntimeConfigForm,
    buildAutoSearchRuntimeConfigForm,
    formatAutoSearchDefaultParams,
    isValidAutoSearchBaseUrl,
    parseAutoSearchDefaultParams,
    readAutoSearchRuntimeConfig,
    resetAutoSearchRuntimeConfig,
    saveAutoSearchRuntimeConfig
} from "../../services/autoSearchRuntimeConfig";
import {
    buildFuzzyPushRuleKeywords,
    createFuzzyPushKeywordRuleId,
    formatFuzzyPushRuleKeywords,
    readFuzzyPushKeywordRules,
    resetFuzzyPushKeywordRules,
    sanitizeFuzzyPushKeywords,
    saveFuzzyPushKeywordRules,
    splitFuzzyPushKeywordText
} from "../../services/fuzzyPushRules";
import { LoginStore, pushResultCount, UserStore } from "../../stores";
import { DEFAULT_SERVER_URL, ServerStore } from "../../stores/server";
import { SSEClient } from "../../utils/sse";
import { ElMessage, fetchWithGM_request, isProdEnv, loginInterceptor, silentlyLogin } from "../../utils/tools";
import { CircleCloseFilled, Collection, PriceTag, Promotion, RefreshRight, Service, Shop, Upload, Wallet } from '../icons';

import { userRemoteLoad } from "../../stores/remote";

const platform = inject('$platform') as AbsPlatform;
const axios = inject('$axios') as AxiosInstance
const serverStore = ServerStore();
const tempServerUrl = ref(serverStore.baseUrl);

const handleUpdateServer = async () => {
    serverStore.setBaseUrl(tempServerUrl.value);
    await serverStore.checkConnection();
    if (serverStore.isOnline) {
        // 连接成功后，立即尝试加载/同步配置
        userRemoteLoad();

        const countdown = ref(3);
        let timer: any = null;

        const notifyInstance = ElNotification({
            title: '连接成功',
            type: 'success',
            duration: 0, // 不自动关闭
            message: h(() => h('div', null, [
                h('p', null, '已成功连接到服务器，正在同步配置...'),
                h('p', {style: 'color: #E6A23C; margin-top: 5px; font-weight: bold;'}, `页面将在 ${countdown.value} 秒后自动刷新以同步登录状态`),
                h('div', {style: 'margin-top: 10px; text-align: right;'}, [
                    h('button', {
                        class: 'el-button el-button--small el-button--warning',
                        onClick: () => {
                            if (timer) {
                                clearInterval(timer);
                                timer = null;
                                notifyInstance.close();
                                ElMessage.info('已取消自动刷新，请手动刷新以同步登录');
                            }
                        }
                    }, '取消刷新')
                ])
            ])) as any
        });

        timer = setInterval(() => {
            countdown.value--;
            if (countdown.value <= 0) {
                clearInterval(timer);
                window.location.reload();
            }
        }, 1000);
    } else {
        ElNotification({
            title: '连接失败',
            message: serverStore.lastError || '无法访问服务器',
            type: 'error',
            duration: 3000
        });
    }
};

const handleResetServer = async () => {
    if (typeof serverStore.resetBaseUrl === 'function') {
        serverStore.resetBaseUrl();
        tempServerUrl.value = serverStore.baseUrl;
        ElMessage.success('已重置为默认服务器地址');
        await handleUpdateServer();
    } else {
        // 容错处理
        serverStore.setBaseUrl(DEFAULT_SERVER_URL);
        tempServerUrl.value = DEFAULT_SERVER_URL;
        ElMessage.success('已重置为默认服务器地址');
        await handleUpdateServer();
    }
};

const pushStatus = ref(PushStatus.NOT_START)
const pushBtnType = ref<'primary' | 'warning'>('primary')
const pushBtnText = ref<string>('开始投递')
const aiSeatBuyVisible = ref(false)
const importResumeLoading = ref<boolean>(false);
const productListLoading = ref<boolean>(false);
const scrollBottomLoading = ref<boolean>(false);

type AutoSearchMode = 'search' | 'quickPush' | 'fuzzyPush';

interface AutoSearchState {
    running: boolean;
    index: number;
    startedAt: number;
    nextSearchAt?: number;
    quickPush?: boolean;
    pushedIndexes?: number[];
    mode?: AutoSearchMode;
    keywords?: string[];
    sourceKeyword?: string;
    maxPushCount?: number;
    successCountAtStart?: number;
    reuseCurrentSearchParams?: boolean;
}

interface PushResumeState {
    running: boolean;
    url: string;
    startedAt: number;
    mockPush?: boolean;
    selfDefPushCountLimit?: number;
    successCountAtStart?: number;
}

interface FuzzyPushRuleForm {
    seedKeyword: string;
    expandedKeywordsText: string;
    enabled: boolean;
}

const AUTO_SEARCH_STATE_KEY = 'ai-job:auto-search:static-keywords-v1';
const PUSH_RESUME_STATE_KEY = 'ai-job:push:resume-state-v1';
const PUSH_RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const AUTO_SEARCH_INTERVAL_MINUTES = 5;
const AUTO_SEARCH_INTERVAL_MS = AUTO_SEARCH_INTERVAL_MINUTES * 60 * 1000;
const AUTO_SEARCH_REFRESH_INTERVAL_MINUTES = 8;
const AUTO_SEARCH_REFRESH_INTERVAL_MS = AUTO_SEARCH_REFRESH_INTERVAL_MINUTES * 60 * 1000;
const AUTO_SEARCH_PUSH_EXTEND_MINUTES = 2;
const AUTO_SEARCH_PUSH_EXTEND_MS = AUTO_SEARCH_PUSH_EXTEND_MINUTES * 60 * 1000;
const AUTO_SEARCH_PUSH_START_DELAY_MS = 2500;
const autoSearchKeywords = ref<string[]>(readAutoSearchKeywords());
const autoSearchKeywordDialogVisible = ref(false);
const autoSearchKeywordText = ref('');
const autoSearchRuntimeConfig = ref<AutoSearchConfig>(readAutoSearchRuntimeConfig());
const autoSearchConfigDialogVisible = ref(false);
const autoSearchConfigForm = ref<AutoSearchRuntimeConfigForm>(
    buildAutoSearchRuntimeConfigForm(autoSearchRuntimeConfig.value)
);
const fuzzyPushMaxCount = ref(100);
const fuzzyPushRules = ref<FuzzyPushKeywordRule[]>(readFuzzyPushKeywordRules());
const selectedFuzzyPushRuleId = ref(fuzzyPushRules.value.find(rule => rule.enabled)?.id || '');
const fuzzyPushRuleDialogVisible = ref(false);
const fuzzyPushRuleEditingId = ref('');
const fuzzyPushRuleForm = ref<FuzzyPushRuleForm>({
    seedKeyword: '',
    expandedKeywordsText: '',
    enabled: true,
});
const autoSearchRunning = ref(false);
const autoSearchQuickPush = ref(false);
const autoSearchMode = ref<AutoSearchMode>('search');
const autoSearchKeywordTotal = ref(autoSearchKeywords.value.length);
const autoSearchModeText = ref('自动搜索');
const autoSearchNextIndex = ref(0);
const autoSearchCurrentKeyword = ref('');
const autoSearchNextSearchAt = ref(0);
const autoSearchRemainingSeconds = ref(0);
const autoSearchKeywordDraftList = computed(() => sanitizeAutoSearchKeywords(
    splitAutoSearchKeywordText(autoSearchKeywordText.value)
));
const autoSearchDefaultParamCount = computed(() =>
    Object.keys(parseAutoSearchDefaultParams(autoSearchConfigForm.value.defaultParamsText)).length
);
const autoSearchReuseCurrentSearchParams = computed({
    get: () => autoSearchRuntimeConfig.value.reuseCurrentSearchParams,
    set: (value: boolean) => {
        autoSearchRuntimeConfig.value = saveAutoSearchRuntimeConfig({
            ...autoSearchRuntimeConfig.value,
            reuseCurrentSearchParams: value,
        });
    },
});
const enabledFuzzyPushRules = computed(() => fuzzyPushRules.value.filter(rule => rule.enabled));
const selectedFuzzyPushRule = computed(() =>
    enabledFuzzyPushRules.value.find(rule => rule.id === selectedFuzzyPushRuleId.value) || null
);
const fuzzyPushKeywordListPreview = computed(() =>
    selectedFuzzyPushRule.value ? buildFuzzyPushRuleKeywords(selectedFuzzyPushRule.value) : []
);
const fuzzyPushEnabledRuleCount = computed(() => fuzzyPushRules.value.filter(rule => rule.enabled).length);
const autoSearchBtnType = computed(() => autoSearchRunning.value && autoSearchMode.value === 'search' ? 'warning' : 'primary');
const autoSearchBtnText = computed(() => autoSearchRunning.value && autoSearchMode.value === 'search' ? '停止搜索' : '自动搜索');
const quickPushBtnType = computed(() => autoSearchRunning.value && autoSearchMode.value === 'quickPush' ? 'warning' : 'success');
const quickPushBtnText = computed(() => autoSearchRunning.value && autoSearchMode.value === 'quickPush' ? '停止快投' : '快速投递');
const fuzzyPushBtnType = computed(() => autoSearchRunning.value && autoSearchMode.value === 'fuzzyPush' ? 'warning' : 'success');
const fuzzyPushBtnText = computed(() => autoSearchRunning.value && autoSearchMode.value === 'fuzzyPush' ? '停止模糊快投' : '开始模糊快投');
const autoSearchProgressText = computed(() => {
    if (!autoSearchRunning.value) {
        return `共 ${autoSearchKeywords.value.length} 个关键词`;
    }
    const modeText = autoSearchModeText.value;
    const currentNo = Math.min(autoSearchNextIndex.value, autoSearchKeywordTotal.value);
    const currentKeywordText = autoSearchCurrentKeyword.value ? `当前：${autoSearchCurrentKeyword.value}` : '准备开始';
    if (!autoSearchNextSearchAt.value) {
        return `${modeText}，${currentKeywordText} (${currentNo}/${autoSearchKeywordTotal.value})，正在设置下一次搜索时间`;
    }
    if (autoSearchQuickPush.value) {
        return `${modeText}，${currentKeywordText} (${currentNo}/${autoSearchKeywordTotal.value})，投递完成后立即搜索下一条，兜底倒计时 ${formatAutoSearchCountdown(autoSearchRemainingSeconds.value)}`;
    }
    return `${modeText}，${currentKeywordText} (${currentNo}/${autoSearchKeywordTotal.value})，下次搜索 ${formatAutoSearchTime(autoSearchNextSearchAt.value)}，倒计时 ${formatAutoSearchCountdown(autoSearchRemainingSeconds.value)}`;
});
let autoSearchTimer: number | null = null;
let autoSearchPushTimer: number | null = null;
let autoSearchCountdownTimer: number | null = null;
let autoSearchRefreshTimer: number | null = null;

// 创建日志记录器实例
const logRecorder = new LogRecorder();
const latestPushRecords = ref<{ level: string; message: string; timestamp: string }[]>([]);
let recordsUpdateTimer: number | null = null;

// 已经购买产品
const buyProductList = ref([])

// 显示其他产品
const showOtherProduct = ref(true)
const orderGroup: Ref = ref([])
const payStatus = ref(false)
const promotionCode = ref('')
const lastPromotionCode = ref('')

let loginStore = LoginStore();
let pushResultCounter = pushResultCount();

const userStore = UserStore();
// --------------------------------------------------函数定义-------------------------------------------------------------

// 获取最新的投递记录
const updateLatestPushRecords = () => {
    const allLogs = logRecorder.getLogs(1, logRecorder.getLogCount());
    // 筛选投递相关的日志（包含"投递"、"push"等关键词）
    const pushLogs = allLogs.filter(log =>
        log.message.toLowerCase().includes('投递') ||
        log.message.toLowerCase().includes('下一页') ||
        log.message.toLowerCase().includes('工作')
    );
    // 获取最新的5条记录，最新数据在下方
    latestPushRecords.value = pushLogs.slice(-10);
};

// 获取记录级别的样式类
const getRecordLevelClass = (level: string): string => {
    switch (level.toLowerCase()) {
        case 'error':
            return 'record-error';
        case 'warn':
            return 'record-warn';
        case 'info':
            return 'record-info';
        case 'debug':
            return 'record-debug';
        case 'trace':
            return 'record-trace';
        default:
            return 'record-info';
    }
};

// 开始定时更新记录
const startRecordsUpdate = () => {
    if (recordsUpdateTimer) {
        clearInterval(recordsUpdateTimer);
    }
    updateLatestPushRecords();
    // 每200ms更新一次
    recordsUpdateTimer = setInterval(updateLatestPushRecords, 500);
};

// 停止定时更新记录
const stopRecordsUpdate = () => {
    if (recordsUpdateTimer) {
        clearInterval(recordsUpdateTimer);
        recordsUpdateTimer = null;
    }
};

const isExpired = (row: any): boolean => {
    const currentTime = new Date();
    const endTime = new Date(row.periodOfValidityEndTime);
    return currentTime > endTime;
}


const randomStyle = (): string => {
    const tagStyleArr = ['primary', 'warning', 'success', 'danger']
    let number = Math.floor(Math.random() * 4);
    return tagStyleArr[number];
}

// 滚动到页面顶部
const scrollToTop = () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// --------------------------------------------------函数定义-------------------------------------------------------------


// --------------------------------------------------事件处理-------------------------------------------------------------
const handlerImport = async () => {

    if (!loginInterceptor()) {
        return;
    }
    const token = Tools.window?._PAGE?.token;
    let bossUserId = Tools.window?._PAGE?.uid
    if (!bossUserId) {
        ElMessage({
            message: "未获取到Boss userId 请刷新页面重试",
            type: 'error',
            duration: 3000
        })
        return;
    }

    importResumeLoading.value = true;
    // 获取简历id
    let resumeInfoResp = await axiosOriginal.get("https://www.zhipin.com/wapi/zpgeek/resume/sidebar.json", {headers: {"Zp_token": token}} as {})
    let zpData = resumeInfoResp.data.zpData;
    if (!zpData.attachmentList || zpData.attachmentList.length == 0) {
        importResumeLoading.value = false;
        ElMessage({
            message: "请先在BOSS个人中心上传附件简历；作为ai坐席定制化回复的基础",
            type: 'error',
            duration: 3000
        })
        return;
    }
    let resumeId = zpData.attachmentList[0].resumeId

    // 获取简历文件
    let resumeFileResp: any = await fetchWithGM_request("https://docdownload.zhipin.com/wflow/zpgeek/download/download4geek?resumeId=" + resumeId,
        {headers: {"Zp_token": token}, responseType: 'arraybuffer'} as {})
    let fileBlob = new Blob([resumeFileResp.response], {type: 'application/pdf'});

    // 导入简历
    let formData = new FormData();
    formData.append("file", fileBlob)
    formData.append("resumeId", resumeId)
    formData.append("uniqueId", bossUserId)
    let importResp = await axios.post("/api/user/import/resume", formData, {headers: {'Content-Type': "multipart/form-data"}})
    if (importResp.data.code != 200) {
        ElMessage({
            message: "导入简历失败" + importResp.data.data.msg,
            type: 'error',
            duration: 3000
        })
        importResumeLoading.value = false;
        return;
    }
    let loginResp = await axios.post("/api/user/silently/login?uniqueId=" + bossUserId)
    localStorage.setItem('Authorization', loginResp.data.data);
    if(!importResp.data.data.email){
        ElMessage({
            message: "导入简历成功；但未识别到邮箱，请在偏好设置中完善[通知邮箱]",
            type: 'warning',
            duration: 3000
        })
        importResumeLoading.value = false;
        return;
    }
    ElMessage({
        message: "导入简历成功",
        type: 'success',
        duration: 3000
    });
    importResumeLoading.value = false;
}
const handlerPush = () => {
    switch (pushStatus.value) {
        case PushStatus.NOT_START:
            startPush();
            break;
        case PushStatus.PUSHING:
            pausePush();
            break;
        case PushStatus.PAUSE:
            startPush()
            break;
    }
}

// 固定按钮停止投递处理
const handlerFixedStopPush = () => {
    if (autoSearchRunning.value && autoSearchQuickPush.value) {
        stopAutoSearch();
        scrollToTop();
        return;
    }
    pausePush();
    scrollToTop();
}

const handlerScrollToBottomThenTop = async () => {
    if (scrollBottomLoading.value) {
        return;
    }
    scrollBottomLoading.value = true;
    try {
        await platform.scrollToBottomThenTop();
        ElMessage({
            message: "已到达页面底部并回到顶部",
            type: 'success',
            duration: 2000
        })
    } catch (error: any) {
        logger.warn("一键到达页面底部失败", error)
        ElMessage({
            message: "一键到达页面底部失败：" + (error?.message || error),
            type: 'error',
            duration: 3000
        })
    } finally {
        scrollBottomLoading.value = false;
    }
}

const sanitizeKeywordList = (keywords: string[]): string[] => {
    return sanitizeAutoSearchKeywords(keywords);
}

const openAutoSearchKeywordDialog = () => {
    autoSearchKeywordText.value = formatAutoSearchKeywords(autoSearchKeywords.value);
    autoSearchKeywordDialogVisible.value = true;
}

const saveAutoSearchKeywordDialog = () => {
    const nextKeywords = autoSearchKeywordDraftList.value;
    if (nextKeywords.length === 0) {
        ElMessage({
            message: "请至少输入一个有效岗位关键词",
            type: 'warning',
            duration: 3000
        })
        return;
    }
    autoSearchKeywords.value = saveAutoSearchKeywords(nextKeywords);
    autoSearchKeywordText.value = formatAutoSearchKeywords(autoSearchKeywords.value);
    autoSearchKeywordDialogVisible.value = false;
    ElMessage({
        message: `已保存 ${autoSearchKeywords.value.length} 个自动搜索关键词`,
        type: 'success',
        duration: 2000
    })
}

const resetAutoSearchKeywordDialog = () => {
    autoSearchKeywords.value = resetAutoSearchKeywords();
    autoSearchKeywordText.value = formatAutoSearchKeywords(autoSearchKeywords.value);
    ElMessage({
        message: "已恢复默认自动搜索关键词",
        type: 'success',
        duration: 2000
    })
}

const openAutoSearchConfigDialog = () => {
    autoSearchConfigForm.value = buildAutoSearchRuntimeConfigForm(autoSearchRuntimeConfig.value);
    autoSearchConfigDialogVisible.value = true;
}

const saveAutoSearchConfigDialog = () => {
    const baseUrl = autoSearchConfigForm.value.baseUrl.trim();
    if (!isValidAutoSearchBaseUrl(baseUrl)) {
        ElMessage({
            message: "请输入有效的搜索页地址",
            type: 'warning',
            duration: 3000
        })
        return;
    }
    autoSearchRuntimeConfig.value = saveAutoSearchRuntimeConfig({
        baseUrl,
        defaultParams: parseAutoSearchDefaultParams(autoSearchConfigForm.value.defaultParamsText),
        reuseCurrentSearchParams: autoSearchConfigForm.value.reuseCurrentSearchParams,
    });
    autoSearchConfigForm.value = buildAutoSearchRuntimeConfigForm(autoSearchRuntimeConfig.value);
    autoSearchConfigDialogVisible.value = false;
    ElMessage({
        message: "已保存搜索参数设置",
        type: 'success',
        duration: 2000
    })
}

const resetAutoSearchConfigDialog = () => {
    autoSearchRuntimeConfig.value = resetAutoSearchRuntimeConfig();
    autoSearchConfigForm.value = buildAutoSearchRuntimeConfigForm(autoSearchRuntimeConfig.value);
    ElMessage({
        message: "已恢复默认搜索参数",
        type: 'success',
        duration: 2000
    })
}

const importAutoSearchConfigFromCurrentPage = () => {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("query");
    const currentParams: Record<string, string> = {};
    currentUrl.searchParams.forEach((value, key) => {
        currentParams[key] = value;
    });
    autoSearchConfigForm.value = {
        baseUrl: `${currentUrl.origin}${currentUrl.pathname}`,
        defaultParamsText: formatAutoSearchDefaultParams(currentParams),
        reuseCurrentSearchParams: autoSearchConfigForm.value.reuseCurrentSearchParams,
    };
    ElMessage({
        message: "已从当前页面导入搜索参数",
        type: 'success',
        duration: 2000
    })
}

const syncSelectedFuzzyPushRule = () => {
    if (enabledFuzzyPushRules.value.some(rule => rule.id === selectedFuzzyPushRuleId.value)) {
        return;
    }
    selectedFuzzyPushRuleId.value = enabledFuzzyPushRules.value[0]?.id || '';
}

const persistFuzzyPushRules = (rules: FuzzyPushKeywordRule[]) => {
    fuzzyPushRules.value = saveFuzzyPushKeywordRules(rules);
    syncSelectedFuzzyPushRule();
}

const resetFuzzyPushRuleForm = () => {
    fuzzyPushRuleEditingId.value = '';
    fuzzyPushRuleForm.value = {
        seedKeyword: '',
        expandedKeywordsText: '',
        enabled: true,
    };
}

const openFuzzyPushRuleDialog = () => {
    fuzzyPushRules.value = readFuzzyPushKeywordRules();
    syncSelectedFuzzyPushRule();
    resetFuzzyPushRuleForm();
    fuzzyPushRuleDialogVisible.value = true;
}

const editFuzzyPushRule = (rule: FuzzyPushKeywordRule) => {
    fuzzyPushRuleEditingId.value = rule.id;
    fuzzyPushRuleForm.value = {
        seedKeyword: rule.seedKeyword,
        expandedKeywordsText: formatFuzzyPushRuleKeywords(rule),
        enabled: rule.enabled,
    };
}

const saveFuzzyPushRuleForm = () => {
    const seedKeyword = fuzzyPushRuleForm.value.seedKeyword.trim();
    const expandedKeywords = sanitizeFuzzyPushKeywords(
        splitFuzzyPushKeywordText(fuzzyPushRuleForm.value.expandedKeywordsText)
    );
    if (!seedKeyword || isInvalidAutoSearchKeyword(seedKeyword)) {
        ElMessage({
            message: "请输入有效的种子关键词",
            type: 'warning',
            duration: 3000
        })
        return;
    }
    if (expandedKeywords.length === 0) {
        ElMessage({
            message: "请至少输入一个扩展搜索关键词",
            type: 'warning',
            duration: 3000
        })
        return;
    }

    const editingId = fuzzyPushRuleEditingId.value;
    const seedKey = seedKeyword.toLowerCase();
    const existingRule = fuzzyPushRules.value.find(rule =>
        rule.id === editingId || rule.seedKeyword.trim().toLowerCase() === seedKey
    );
    const nextRule: FuzzyPushKeywordRule = {
        id: existingRule?.id || createFuzzyPushKeywordRuleId(),
        seedKeyword,
        expandedKeywords,
        enabled: fuzzyPushRuleForm.value.enabled,
        updatedAt: Date.now(),
    };
    const nextRules = fuzzyPushRules.value.filter(rule =>
        rule.id !== editingId && rule.seedKeyword.trim().toLowerCase() !== seedKey
    );
    persistFuzzyPushRules([...nextRules, nextRule]);
    resetFuzzyPushRuleForm();
    ElMessage({
        message: existingRule ? "已更新模糊快投词库规则" : "已新增模糊快投词库规则",
        type: 'success',
        duration: 2000
    })
}

const toggleFuzzyPushRule = (ruleId: string, enabled: boolean) => {
    persistFuzzyPushRules(fuzzyPushRules.value.map(rule => rule.id === ruleId
        ? {
            ...rule,
            enabled,
            updatedAt: Date.now(),
        }
        : rule
    ));
}

const removeFuzzyPushRule = (ruleId: string) => {
    persistFuzzyPushRules(fuzzyPushRules.value.filter(rule => rule.id !== ruleId));
    if (fuzzyPushRuleEditingId.value === ruleId) {
        resetFuzzyPushRuleForm();
    }
    ElMessage({
        message: "已删除模糊快投词库规则",
        type: 'success',
        duration: 2000
    })
}

const resetFuzzyPushRulesToDefaults = () => {
    fuzzyPushRules.value = resetFuzzyPushKeywordRules();
    syncSelectedFuzzyPushRule();
    resetFuzzyPushRuleForm();
    ElMessage({
        message: "已恢复默认模糊快投词库",
        type: 'success',
        duration: 2000
    })
}

const getAutoSearchKeywords = (state?: AutoSearchState | null): string[] => {
    if (state && getAutoSearchMode(state) === 'fuzzyPush') {
        if (state.sourceKeyword) {
            const sourceKey = state.sourceKeyword.trim().toLowerCase();
            const matchedRule = fuzzyPushRules.value.find(rule =>
                rule.enabled && rule.seedKeyword.trim().toLowerCase() === sourceKey
            );
            if (matchedRule) {
                return buildFuzzyPushRuleKeywords(matchedRule);
            }
        }
        return [];
    }
    return sanitizeKeywordList(state?.keywords?.length ? state.keywords : autoSearchKeywords.value);
}

const getAutoSearchMode = (state?: AutoSearchState | null): AutoSearchMode => {
    if (state?.mode) {
        return state.mode;
    }
    return state?.quickPush ? 'quickPush' : 'search';
}

const getAutoSearchModeText = (state?: AutoSearchState | null): string => {
    const mode = getAutoSearchMode(state);
    if (mode === 'fuzzyPush') {
        return '模糊快投';
    }
    if (mode === 'quickPush') {
        return '快速投递';
    }
    return '自动搜索';
}

const getAutoSearchSuccessCount = (state: AutoSearchState): number => {
    const successCountAtStart = typeof state.successCountAtStart === 'number'
        ? state.successCountAtStart
        : pushResultCounter.successCount;
    return Math.max(0, pushResultCounter.successCount - successCountAtStart);
}

const hasAutoSearchReachedMaxPush = (state: AutoSearchState): boolean => {
    return typeof state.maxPushCount === 'number'
        && state.maxPushCount > 0
        && getAutoSearchSuccessCount(state) >= state.maxPushCount;
}

const isLegacyFuzzySeedKeywordRemoved = (
    state: AutoSearchState,
    mode: AutoSearchMode,
    keywords: string[]
): boolean => {
    const sourceKeyword = state.sourceKeyword?.trim().toLowerCase();
    if (mode !== 'fuzzyPush' || !sourceKeyword) {
        return false;
    }
    const storedKeywords = sanitizeKeywordList(state.keywords || []);
    return storedKeywords[0]?.toLowerCase() === sourceKeyword
        && !keywords.some(item => item.toLowerCase() === sourceKeyword);
}

const getFuzzyPushPerKeywordLimit = (state: AutoSearchState): number => {
    if (getAutoSearchMode(state) !== 'fuzzyPush'
        || typeof state.maxPushCount !== 'number'
        || state.maxPushCount <= 0) {
        return 0;
    }
    const keywordCount = Math.max(1, getAutoSearchKeywords(state).length);
    return Math.max(1, Math.ceil(state.maxPushCount / keywordCount));
}

const applyAutoSearchPushLimit = (state: AutoSearchState): boolean => {
    if (typeof state.maxPushCount !== 'number' || state.maxPushCount <= 0) {
        return true;
    }
    const remainingLimit = state.maxPushCount - getAutoSearchSuccessCount(state);
    if (remainingLimit <= 0) {
        finishAutoSearch();
        return false;
    }
    const fuzzyPerKeywordLimit = getFuzzyPushPerKeywordLimit(state);
    const currentLimit = fuzzyPerKeywordLimit > 0
        ? Math.min(remainingLimit, fuzzyPerKeywordLimit)
        : remainingLimit;
    platform.selfDefPushCountLimit = currentLimit;
    selfDefPushCountLimit.value = currentLimit;
    return true;
}

const readAutoSearchState = (): AutoSearchState | null => {
    const rawState = localStorage.getItem(AUTO_SEARCH_STATE_KEY);
    if (!rawState) {
        return null;
    }
    try {
        const state = JSON.parse(rawState) as AutoSearchState;
        if (typeof state?.running !== 'boolean' || typeof state?.index !== 'number') {
            localStorage.removeItem(AUTO_SEARCH_STATE_KEY);
            return null;
        }
        const mode = getAutoSearchMode(state);
        const keywords = getAutoSearchKeywords(state);
        const legacySeedRemoved = isLegacyFuzzySeedKeywordRemoved(state, mode, keywords);
        const normalizedIndex = normalizeAutoSearchIndex(
            legacySeedRemoved ? state.index - 1 : state.index,
            keywords
        );
        const normalizedPushedIndexes = normalizeAutoSearchPushedIndexes(
            legacySeedRemoved ? state.pushedIndexes?.map(index => index - 1) : state.pushedIndexes,
            keywords
        );
        return {
            running: state.running,
            index: normalizedIndex,
            startedAt: Number(state.startedAt) || Date.now(),
            nextSearchAt: Number(state.nextSearchAt) || 0,
            quickPush: mode === 'quickPush' || mode === 'fuzzyPush' || !!state.quickPush,
            pushedIndexes: normalizedPushedIndexes,
            mode,
            keywords,
            sourceKeyword: state.sourceKeyword || '',
            maxPushCount: typeof state.maxPushCount === 'number' ? state.maxPushCount : undefined,
            successCountAtStart: typeof state.successCountAtStart === 'number'
                ? state.successCountAtStart
                : pushResultCounter.successCount,
            reuseCurrentSearchParams: typeof state.reuseCurrentSearchParams === 'boolean'
                ? state.reuseCurrentSearchParams
                : autoSearchRuntimeConfig.value.reuseCurrentSearchParams,
        };
    } catch (error) {
        logger.warn("读取自动搜索状态失败", error);
        localStorage.removeItem(AUTO_SEARCH_STATE_KEY);
        return null;
    }
}

const saveAutoSearchState = (state: AutoSearchState) => {
    const keywords = getAutoSearchKeywords(state);
    const mode = getAutoSearchMode(state);
    localStorage.setItem(AUTO_SEARCH_STATE_KEY, JSON.stringify({
        ...state,
        mode,
        keywords,
        quickPush: mode === 'quickPush' || mode === 'fuzzyPush' || !!state.quickPush,
        index: normalizeAutoSearchIndex(state.index, keywords),
        pushedIndexes: normalizeAutoSearchPushedIndexes(state.pushedIndexes, keywords),
    }));
}

const normalizeAutoSearchIndex = (index: number, keywords = autoSearchKeywords.value): number => {
    if (!Number.isFinite(index)) {
        return 0;
    }
    return Math.max(0, Math.min(Math.floor(index), keywords.length));
}

const normalizeAutoSearchPushedIndexes = (indexes?: number[], keywords = autoSearchKeywords.value): number[] => {
    if (!Array.isArray(indexes)) {
        return [];
    }
    return Array.from(new Set(indexes
        .map(index => Math.floor(Number(index)))
        .filter(index => Number.isFinite(index) && index >= 0 && index < keywords.length)
    ));
}

const getCurrentAutoSearchKeywordIndex = (state: AutoSearchState): number => {
    return normalizeAutoSearchIndex(state.index, getAutoSearchKeywords(state)) - 1;
}

const isCurrentAutoSearchKeywordPushed = (state: AutoSearchState): boolean => {
    const keywordIndex = getCurrentAutoSearchKeywordIndex(state);
    return keywordIndex >= 0 && normalizeAutoSearchPushedIndexes(state.pushedIndexes, getAutoSearchKeywords(state)).includes(keywordIndex);
}

const isSamePushResumeUrl = (url: string): boolean => {
    try {
        const savedUrl = new URL(url);
        const currentUrl = new URL(window.location.href);
        return savedUrl.origin === currentUrl.origin
            && savedUrl.pathname === currentUrl.pathname
            && savedUrl.search === currentUrl.search;
    } catch (error) {
        logger.warn("解析投递恢复地址失败", error);
        return false;
    }
}

const readPushResumeState = (): PushResumeState | null => {
    const rawState = localStorage.getItem(PUSH_RESUME_STATE_KEY);
    if (!rawState) {
        return null;
    }
    try {
        const state = JSON.parse(rawState) as PushResumeState;
        if (!state?.running || !state.url || Date.now() - Number(state.startedAt) > PUSH_RESUME_MAX_AGE_MS) {
            localStorage.removeItem(PUSH_RESUME_STATE_KEY);
            return null;
        }
        return {
            running: true,
            url: state.url,
            startedAt: Number(state.startedAt) || Date.now(),
            mockPush: !!state.mockPush,
            selfDefPushCountLimit: typeof state.selfDefPushCountLimit === 'number'
                ? state.selfDefPushCountLimit
                : -1,
            successCountAtStart: typeof state.successCountAtStart === 'number'
                ? state.successCountAtStart
                : pushResultCounter.successCount,
        };
    } catch (error) {
        logger.warn("读取投递恢复状态失败", error);
        localStorage.removeItem(PUSH_RESUME_STATE_KEY);
        return null;
    }
}

const savePushResumeState = () => {
    localStorage.setItem(PUSH_RESUME_STATE_KEY, JSON.stringify({
        running: true,
        url: window.location.href,
        startedAt: Date.now(),
        mockPush: mockPush.value,
        selfDefPushCountLimit: platform.selfDefPushCountLimit,
        successCountAtStart: pushResultCounter.successCount,
    } as PushResumeState));
}

const clearPushResumeState = () => {
    localStorage.removeItem(PUSH_RESUME_STATE_KEY);
}

const clearAutoSearchTimer = () => {
    if (autoSearchTimer !== null) {
        clearTimeout(autoSearchTimer);
        autoSearchTimer = null;
    }
}

const clearAutoSearchCountdownTimer = () => {
    if (autoSearchCountdownTimer !== null) {
        clearInterval(autoSearchCountdownTimer);
        autoSearchCountdownTimer = null;
    }
}

const clearAutoSearchPushTimer = () => {
    if (autoSearchPushTimer !== null) {
        clearTimeout(autoSearchPushTimer);
        autoSearchPushTimer = null;
    }
}

const clearAutoSearchRefreshTimer = () => {
    if (autoSearchRefreshTimer !== null) {
        clearTimeout(autoSearchRefreshTimer);
        autoSearchRefreshTimer = null;
    }
}

const startAutoSearchRefreshTimer = () => {
    if (autoSearchRefreshTimer !== null) {
        return;
    }
    autoSearchRefreshTimer = window.setTimeout(() => {
        autoSearchRefreshTimer = null;
        const state = readAutoSearchState();
        if (!state?.running) {
            return;
        }
        logRecorder.info(`自动搜索运行满${AUTO_SEARCH_REFRESH_INTERVAL_MINUTES}分钟，自动刷新页面`);
        window.location.reload();
    }, AUTO_SEARCH_REFRESH_INTERVAL_MS);
}

const formatAutoSearchTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

const formatAutoSearchCountdown = (seconds: number): string => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const restSeconds = safeSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
}

const refreshAutoSearchCountdown = () => {
    if (!autoSearchNextSearchAt.value) {
        autoSearchRemainingSeconds.value = 0;
        return;
    }
    autoSearchRemainingSeconds.value = Math.max(0, Math.ceil((autoSearchNextSearchAt.value - Date.now()) / 1000));
}

const startAutoSearchCountdown = () => {
    clearAutoSearchCountdownTimer();
    if (!autoSearchNextSearchAt.value) {
        autoSearchRemainingSeconds.value = 0;
        return;
    }
    refreshAutoSearchCountdown();
    autoSearchCountdownTimer = window.setInterval(refreshAutoSearchCountdown, 1000);
}

const applyAutoSearchState = (state: AutoSearchState | null) => {
    if (!state?.running) {
        autoSearchRunning.value = false;
        autoSearchQuickPush.value = false;
        autoSearchMode.value = 'search';
        autoSearchKeywordTotal.value = autoSearchKeywords.value.length;
        autoSearchModeText.value = '自动搜索';
        autoSearchNextIndex.value = 0;
        autoSearchCurrentKeyword.value = '';
        autoSearchNextSearchAt.value = 0;
        autoSearchRemainingSeconds.value = 0;
        clearAutoSearchCountdownTimer();
        clearAutoSearchRefreshTimer();
        return;
    }

    autoSearchRunning.value = true;
    autoSearchQuickPush.value = !!state.quickPush;
    autoSearchMode.value = getAutoSearchMode(state);
    autoSearchModeText.value = getAutoSearchModeText(state);
    const keywords = getAutoSearchKeywords(state);
    autoSearchKeywordTotal.value = keywords.length;
    startAutoSearchRefreshTimer();
    autoSearchNextIndex.value = normalizeAutoSearchIndex(state.index, keywords);
    autoSearchCurrentKeyword.value = autoSearchNextIndex.value > 0
        ? keywords[autoSearchNextIndex.value - 1]
        : '';
    autoSearchNextSearchAt.value = Number(state.nextSearchAt) || 0;
    startAutoSearchCountdown();
}

const getAutoSearchBaseUrl = (config = autoSearchRuntimeConfig.value): URL => new URL(config.baseUrl);

const isAutoSearchPageUrl = (url: URL, config = autoSearchRuntimeConfig.value): boolean => {
    const baseUrl = getAutoSearchBaseUrl(config);
    return url.origin === baseUrl.origin && url.pathname === baseUrl.pathname;
}

const applyAutoSearchDefaultParams = (url: URL, config = autoSearchRuntimeConfig.value) => {
    Object.entries(config.defaultParams).forEach(([key, value]) => {
        if (!url.searchParams.has(key)) {
            url.searchParams.set(key, value);
        }
    });
}

const getSortedSearchParamPairs = (url: URL): string[] => {
    const pairs: string[] = [];
    url.searchParams.forEach((value, key) => {
        pairs.push(`${key}=${value}`);
    });
    return pairs.sort();
}

const hasSameSearchParams = (currentUrl: URL, targetUrl: URL): boolean => {
    const currentPairs = getSortedSearchParamPairs(currentUrl);
    const targetPairs = getSortedSearchParamPairs(targetUrl);
    return currentPairs.length === targetPairs.length
        && currentPairs.every((pair, index) => pair === targetPairs[index]);
}

const buildBossSearchUrl = (
    keyword: string,
    reuseCurrentSearchParams = autoSearchRuntimeConfig.value.reuseCurrentSearchParams
): string => {
    const config = autoSearchRuntimeConfig.value;
    const currentUrl = new URL(window.location.href);
    const url = reuseCurrentSearchParams && isAutoSearchPageUrl(currentUrl, config)
        ? currentUrl
        : getAutoSearchBaseUrl(config);

    applyAutoSearchDefaultParams(url, config);
    url.searchParams.set("query", keyword);
    return url.toString();
}

const isSameBossSearchUrl = (targetUrl: string): boolean => {
    const currentUrl = new URL(window.location.href);
    const target = new URL(targetUrl);
    return currentUrl.origin === target.origin
        && currentUrl.pathname === target.pathname
        && hasSameSearchParams(currentUrl, target);
}

const repairMalformedAutoSearchUrl = (state: AutoSearchState): boolean => {
    const currentUrl = new URL(window.location.href);
    const currentQuery = currentUrl.searchParams.get("query") || '';
    if (!isInvalidAutoSearchKeyword(currentQuery)) {
        return false;
    }

    const keywords = getAutoSearchKeywords(state);
    const keywordIndex = normalizeAutoSearchIndex(state.index, keywords) - 1;
    const keyword = keywords[keywordIndex];
    if (!keyword) {
        return false;
    }

    const targetUrl = buildBossSearchUrl(keyword, state.reuseCurrentSearchParams);
    logRecorder.warn(`自动搜索关键词异常，正在修正为：${keyword}`);
    if (!isSameBossSearchUrl(targetUrl)) {
        window.location.assign(targetUrl);
        return true;
    }
    return false;
}

const scheduleNextAutoSearchAt = (nextSearchAt: number) => {
    const state = readAutoSearchState();
    if (!state?.running) {
        applyAutoSearchState(null);
        return;
    }
    const nextState = {
        ...state,
        nextSearchAt,
    };
    saveAutoSearchState(nextState);
    applyAutoSearchState(nextState);

    clearAutoSearchTimer();
    autoSearchTimer = window.setTimeout(runNextAutoSearch, Math.max(0, nextSearchAt - Date.now()));
}

const scheduleNextAutoSearch = (delayMs: number) => {
    scheduleNextAutoSearchAt(Date.now() + delayMs);
}

const extendAutoSearchForRunningPush = (): boolean => {
    if (pushStatus.value !== PushStatus.PUSHING) {
        return false;
    }
    const nextSearchAt = Date.now() + AUTO_SEARCH_PUSH_EXTEND_MS;
    logRecorder.info(`自动投递未结束，下一次搜索顺延${AUTO_SEARCH_PUSH_EXTEND_MINUTES}分钟`);
    scheduleNextAutoSearchAt(nextSearchAt);
    return true;
}

const isCurrentAutoSearchResultPage = (state: AutoSearchState): boolean => {
    const keywords = getAutoSearchKeywords(state);
    const keywordIndex = normalizeAutoSearchIndex(state.index, keywords) - 1;
    const keyword = keywords[keywordIndex];
    return !!keyword && isSameBossSearchUrl(buildBossSearchUrl(keyword, state.reuseCurrentSearchParams));
}

const markCurrentAutoSearchKeywordPushed = () => {
    const state = readAutoSearchState();
    if (!state?.running || !isCurrentAutoSearchResultPage(state)) {
        return;
    }
    const keywordIndex = getCurrentAutoSearchKeywordIndex(state);
    if (keywordIndex < 0) {
        return;
    }
    const pushedIndexes = normalizeAutoSearchPushedIndexes(state.pushedIndexes, getAutoSearchKeywords(state));
    if (!pushedIndexes.includes(keywordIndex)) {
        saveAutoSearchState({
            ...state,
            pushedIndexes: [...pushedIndexes, keywordIndex],
        });
    }
}

const pauseAutoSearchPush = () => {
    clearAutoSearchPushTimer();
    if (pushStatus.value === PushStatus.PUSHING) {
        pausePush();
    }
}

const scheduleAutoSearchPush = (state: AutoSearchState) => {
    clearAutoSearchPushTimer();
    if (!state.running || !isCurrentAutoSearchResultPage(state)) {
        return;
    }
    if (hasAutoSearchReachedMaxPush(state)) {
        finishAutoSearch();
        return;
    }
    if (isCurrentAutoSearchKeywordPushed(state)) {
        return;
    }
    autoSearchPushTimer = window.setTimeout(() => {
        const latestState = readAutoSearchState();
        if (!latestState?.running || !isCurrentAutoSearchResultPage(latestState)) {
            return;
        }
        if (isCurrentAutoSearchKeywordPushed(latestState)) {
            return;
        }
        if (!applyAutoSearchPushLimit(latestState)) {
            return;
        }
        if (pushStatus.value === PushStatus.PUSHING) {
            return;
        }
        logRecorder.info("自动搜索已进入结果页，启动自动投递");
        startPush();
    }, AUTO_SEARCH_PUSH_START_DELAY_MS);
}

const finishAutoSearch = () => {
    const state = readAutoSearchState();
    const modeText = getAutoSearchModeText(state);
    clearAutoSearchTimer();
    pauseAutoSearchPush();
    localStorage.removeItem(AUTO_SEARCH_STATE_KEY);
    applyAutoSearchState(null);
    logRecorder.info(`${modeText}完成`);
    ElMessage({
        message: `${modeText}完成`,
        type: 'success',
        duration: 3000
    })
}

const stopAutoSearch = () => {
    const state = readAutoSearchState();
    const modeText = getAutoSearchModeText(state);
    clearAutoSearchTimer();
    pauseAutoSearchPush();
    localStorage.removeItem(AUTO_SEARCH_STATE_KEY);
    applyAutoSearchState(null);
    logRecorder.info(`已停止${modeText}`);
    ElMessage({
        message: `已停止${modeText}`,
        type: 'warning',
        duration: 3000
    })
}

const runNextAutoSearch = () => {
    const state = readAutoSearchState();
    if (!state?.running) {
        applyAutoSearchState(null);
        return;
    }
    if (extendAutoSearchForRunningPush()) {
        return;
    }
    if (hasAutoSearchReachedMaxPush(state)) {
        finishAutoSearch();
        return;
    }
    const keywords = getAutoSearchKeywords(state);
    if (state.index >= keywords.length) {
        finishAutoSearch();
        return;
    }

    pauseAutoSearchPush();
    const keyword = keywords[state.index];
    const nextState = {
        ...state,
        index: state.index + 1,
        nextSearchAt: 0,
    };
    saveAutoSearchState(nextState);
    applyAutoSearchState(nextState);
    logRecorder.info(`${getAutoSearchModeText(state)}关键词(${nextState.index}/${keywords.length})：${keyword}`);

    const targetUrl = buildBossSearchUrl(keyword, state.reuseCurrentSearchParams);
    if (isSameBossSearchUrl(targetUrl)) {
        scheduleNextAutoSearch(AUTO_SEARCH_INTERVAL_MS);
        scheduleAutoSearchPush(nextState);
        return;
    }
    window.location.assign(targetUrl);
}

const startKeywordQueue = (
    keywords: string[],
    mode: AutoSearchMode,
    options: {
        sourceKeyword?: string;
        maxPushCount?: number;
        reuseCurrentSearchParams?: boolean;
    } = {}
) => {
    if (!loginInterceptor()) {
        return;
    }
    if (pushStatus.value === PushStatus.PUSHING) {
        ElMessage({
            message: "投递运行中，请先停止投递",
            type: 'warning',
            duration: 3000
        })
        return;
    }
    const safeKeywords = sanitizeKeywordList(keywords);
    if (safeKeywords.length === 0) {
        ElMessage({
            message: mode === 'fuzzyPush' ? "请先在模糊词库配置并启用投递规则" : "关键词库为空，请先点击搜索关键词维护关键词",
            type: 'error',
            duration: 3000
        })
        return;
    }
    if (mode === 'fuzzyPush' && (!options.maxPushCount || options.maxPushCount <= 0)) {
        ElMessage({
            message: "模糊快投最大投递数必须大于0",
            type: 'warning',
            duration: 3000
        })
        return;
    }

    const initState: AutoSearchState = {
        running: true,
        index: 0,
        startedAt: Date.now(),
        nextSearchAt: 0,
        quickPush: mode === 'quickPush' || mode === 'fuzzyPush',
        pushedIndexes: [],
        mode,
        keywords: safeKeywords,
        sourceKeyword: options.sourceKeyword,
        maxPushCount: options.maxPushCount,
        successCountAtStart: pushResultCounter.successCount,
        reuseCurrentSearchParams: typeof options.reuseCurrentSearchParams === 'boolean'
            ? options.reuseCurrentSearchParams
            : autoSearchRuntimeConfig.value.reuseCurrentSearchParams,
    };
    saveAutoSearchState(initState);
    applyAutoSearchState(initState);
    if (mode === 'fuzzyPush') {
        applyAutoSearchPushLimit(initState);
    }
    logRecorder.info(`${getAutoSearchModeText(initState)}启动，共${safeKeywords.length}个关键词：${safeKeywords.join("、")}`);
    runNextAutoSearch();
}

const startAutoSearch = (quickPush = false) => {
    startKeywordQueue(autoSearchKeywords.value, quickPush ? 'quickPush' : 'search');
}

const resumeAutoSearch = () => {
    const state = readAutoSearchState();
    if (!state?.running) {
        applyAutoSearchState(null);
        return;
    }
    if (state.index >= getAutoSearchKeywords(state).length || hasAutoSearchReachedMaxPush(state)) {
        finishAutoSearch();
        return;
    }

    applyAutoSearchState(state);
    if (repairMalformedAutoSearchUrl(state)) {
        return;
    }
    const nextSearchAt = state.nextSearchAt && state.nextSearchAt > Date.now()
        ? state.nextSearchAt
        : Date.now() + AUTO_SEARCH_INTERVAL_MS;
    scheduleNextAutoSearchAt(nextSearchAt);
    scheduleAutoSearchPush(state);
}

const handlerAutoSearch = () => {
    if (autoSearchRunning.value && autoSearchMode.value === 'search') {
        stopAutoSearch();
        return;
    }
    startAutoSearch();
}

const handlerQuickPush = () => {
    if (autoSearchRunning.value && autoSearchMode.value === 'quickPush') {
        stopAutoSearch();
        return;
    }
    startAutoSearch(true);
}

const handlerFuzzyPush = () => {
    if (autoSearchRunning.value && autoSearchMode.value === 'fuzzyPush') {
        stopAutoSearch();
        return;
    }
    fuzzyPushRules.value = readFuzzyPushKeywordRules();
    syncSelectedFuzzyPushRule();
    const selectedRule = selectedFuzzyPushRule.value;
    if (!selectedRule) {
        ElMessage({
            message: "请先在模糊词库配置并启用投递规则",
            type: 'warning',
            duration: 3000
        })
        return;
    }
    const keywords = buildFuzzyPushRuleKeywords(selectedRule);
    if (keywords.length === 0) {
        ElMessage({
            message: "当前模糊快投规则没有可用的扩展搜索关键词",
            type: 'warning',
            duration: 3000
        })
        return;
    }
    startKeywordQueue(keywords, 'fuzzyPush', {
        sourceKeyword: selectedRule.seedKeyword.trim(),
        maxPushCount: fuzzyPushMaxCount.value,
        reuseCurrentSearchParams: autoSearchRuntimeConfig.value.reuseCurrentSearchParams,
    });
}

const continueQuickPushAfterPushComplete = () => {
    const state = readAutoSearchState();
    if (!state?.running || !state.quickPush) {
        return;
    }
    if (!isCurrentAutoSearchResultPage(state)) {
        return;
    }
    clearAutoSearchTimer();
    if (hasAutoSearchReachedMaxPush(state)) {
        finishAutoSearch();
        return;
    }
    logRecorder.info(`${getAutoSearchModeText(state)}当前关键词已完成，立即搜索下一条`);
    runNextAutoSearch();
}

/**
 * 单次投递次数限制
 */
const selfDefPushCountLimit = ref<number>(platform.selfDefPushCountLimit);
const selfDefPushCountLimitChange = (val: number) => {
    platform.selfDefPushCountLimit = val;
}

// 非生产环境支持mock投递
const mockPush = ref<boolean>(false)

const startPush = () => {

    if (pushStatus.value === PushStatus.PUSHING) {
        return;
    }

    if (!loginInterceptor()) {
        return;
    }

    platform.pushMock = mockPush.value

    pushStatus.value = PushStatus.PUSHING
    pushBtnType.value = 'warning'
    pushBtnText.value = '停止投递'
    savePushResumeState();

    // 开始更新投递记录
    startRecordsUpdate();

    let pushResultPromise = platform.startPush();

    //   投递结果处理
    pushResultPromise.then(() => {
        markCurrentAutoSearchKeywordPushed();
        clearPushResumeState();
        ElMessage({
            message: "批量投递完成",
            type: 'success',
            duration: 3000
        })
        setTimeout(() => {
            pushStatus.value = PushStatus.PAUSE;
            pushBtnType.value = 'primary'
            pushBtnText.value = '开始投递'
            // 停止更新投递记录
            stopRecordsUpdate();
            continueQuickPushAfterPushComplete();
        }, 200)
    }).catch((error: any) => {
        clearPushResumeState();
        logger.error("批量投递异常", error);
        pushStatus.value = PushStatus.PAUSE;
        pushBtnType.value = 'primary'
        pushBtnText.value = '开始投递'
        stopRecordsUpdate();
        ElMessage({
            message: "批量投递异常：" + (error?.message || error),
            type: 'error',
            duration: 3000
        })
    })
}
const pausePush = () => {
    platform.pausePush()
    clearPushResumeState();
    pushStatus.value = PushStatus.PAUSE;
    pushBtnType.value = 'primary'
    pushBtnText.value = '开始投递'
    // 停止更新投递记录
    stopRecordsUpdate();
}

const resumePushAfterRefresh = () => {
    const state = readPushResumeState();
    if (!state?.running || !isSamePushResumeUrl(state.url)) {
        return;
    }
    if (pushStatus.value === PushStatus.PUSHING) {
        return;
    }
    mockPush.value = !!state.mockPush;
    if (typeof state.selfDefPushCountLimit === 'number') {
        const successCountAtStart = typeof state.successCountAtStart === 'number'
            ? state.successCountAtStart
            : pushResultCounter.successCount;
        const successCountAfterStart = Math.max(0, pushResultCounter.successCount - successCountAtStart);
        const remainingLimit = state.selfDefPushCountLimit === -1
            ? -1
            : Math.max(0, state.selfDefPushCountLimit - successCountAfterStart);
        platform.selfDefPushCountLimit = remainingLimit;
        selfDefPushCountLimit.value = remainingLimit;
    }
    logRecorder.info("检测到刷新前投递未结束，继续自动投递");
    startPush();
}

const handlerAISeatClick = async () => {
    //  显示弹窗
    aiSeatBuyVisible.value = true

    if (buyProductList.value.length <= 0) {
        await queryBuyProductList()
    }

    // if (buyProductList.value.length > 0) {
    //     // 显示产品集合
    //     return;
    // }
    showOtherProduct.value = false

    // 没有产品，直接调用接口生成订单组
    // await showOrderGroup()
}

const queryBuyProductList = async () => {
    // 已购买产品集合
    let productResp = await axios.post("/api/product/user/product/list")
    buyProductList.value = productResp.data.data
}

const showOrderGroup = async () => {
    if (!loginInterceptor()) {
        return;
    }
    productListLoading.value = true
    let promotionCodeVar = promotionCode.value.trim()
    promotionCode.value = ''
    setTimeout(() => {
        showOtherProduct.value = true;
    }, 100)
    // 如果之前生成过订单，或者和上次的优惠码一致时，则不再生成订单
    if (orderGroup.value.length < 1 || promotionCodeVar !== lastPromotionCode.value) {
        // 生成订单组
        let orderGroupResp = await axios.post("/api/pay/generate/order/group", {promotionCode: promotionCodeVar});
        if (orderGroupResp.data.code != 200) {
            ElMessage({
                message: orderGroupResp.data.message,
                type: 'warning',
                duration: 3000
            })
            setTimeout(() => {
                showOtherProduct.value = false;
            }, 100)
            productListLoading.value = false
            return;
        }
        orderGroup.value = orderGroupResp.data.data
        lastPromotionCode.value = promotionCodeVar
        productListLoading.value = false
    }
    productListLoading.value = false

    waitUsePay()
}

const waitUsePay = () => {
    // 建立sse连接，用于服务端通知前端订单支付成功
    const sseClient = new SSEClient(axios.defaults.baseURL + 'api/sse/connect');
    sseClient.addOnMsgCallback((event: any) => {
        let data = event.data;
        if (data === "支付成功") {
            // 支付成功，清除之前的付款二维码
            payStatus.value = true
            orderGroup.value = []
            queryBuyProductList()
            showOtherProduct.value = false
            firstAiSeatStatus.value = 0;
        }
    })
    sseClient.start();

    // 半分钟之后主动查询订单状态
    let count = 0;
    let interval = setInterval(() => {
        if (payStatus.value) {
            // sse通知订单已经支付成功，取消轮询查询订单
            clearInterval(interval)
        }
        orderGroup.value.forEach((orderItem: any) => {
            axios.get("/api/pay/searchOrder?outTradeNo=" + orderItem.orderId).then(resp => {
                if (resp.data.data === "TRADE_SUCCESS") {
                    payStatus.value = true
                    orderGroup.value = []
                    clearInterval(interval)
                }
                if (resp.data.data === "WAIT_BUYER_PAY") {
                    logger.debug("等待支付")
                }

                count++
                if (count >= 10) {
                    logger.warn("订单超时未支付")
                    clearInterval(interval)
                }
            })
        })
    }, 30000);
}

const firstAiSeatStatus = ref(userStore.user.aiSeatStatus)
setTimeout(() => {
    firstAiSeatStatus.value = userStore.user.aiSeatStatus
    logger.info("firstAiSeatStatus", firstAiSeatStatus.value)
}, 1500)

const handlerAISeatStatusChange = async (val: boolean) => {
    if (firstAiSeatStatus.value == null) {
        return;
    }

    if (!loginInterceptor()) {
        return;
    }

    return silentlyLogin("", true).then(_ => axios.post("/api/user/save/preference", {
        aiSeatStatus: val ? 1 : 0
    })).then(resp => {
        if (val && resp.data.message && resp.data.message !== "成功") {
            ElNotification({
                message: resp.data.message,
                type: 'success',
                duration: 2000
            });
        }
    }).catch(_ => {
        userStore.user.aiSeatStatus = firstAiSeatStatus.value
    })
}
const handlerAISeatSwitchClick = async () => {
    if (firstAiSeatStatus.value == null) {
        ElMessage({
            message: "请先点击前面的AI坐席购买",
            grouping: true,
            type: 'info',
            duration: 3000
        })
    }
}


// --------------------------------------------------事件处理-------------------------------------------------------------

// --------------------------------------------------流程处理-------------------------------------------------------------

// 静默登录
if (!loginStore.login && !loginStore.loginFailStatus) {
    logger.info("页面静默登录")
    silentlyLogin("").catch(_ => {
    })
}

// 组件卸载时清理定时器
onMounted(() => {
    resumeAutoSearch();
    window.setTimeout(resumePushAfterRefresh, 1500);
});

onUnmounted(() => {
    stopRecordsUpdate();
    clearAutoSearchTimer();
    clearAutoSearchPushTimer();
    clearAutoSearchCountdownTimer();
    clearAutoSearchRefreshTimer();
});

// --------------------------------------------------流程处理-------------------------------------------------------------
</script>

<style scoped>
.server-config-card {
    margin-bottom: 20px;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    border-radius: 12px;
}

.server-config-container {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
}

.server-status {
    min-width: 120px;
}

.server-input {
    flex: 1;
    min-width: 450px;
}

:deep(.custom-server-input .el-input-group__prepend) {
    width: 100px;
    text-align: center;
    padding: 0 10px;
}

:deep(.custom-server-input .el-input-group__append) {
    padding: 0;
    width: 140px;
}

:deep(.custom-server-input .el-input-group__append .btn-group) {
    display: flex;
    height: 100%;
    width: 100%;
}

:deep(.custom-server-input .el-input-group__append .el-button) {
    border: none;
    margin: 0;
    height: 100%;
    flex: 1;
    border-radius: 0;
    display: flex;
    justify-content: center;
    align-items: center;
}

:deep(.custom-server-input .el-input-group__append .test-btn) {
    padding: 0 10px;
    border-right: 1px solid #dcdfe6;
    flex: 2;
}

:deep(.custom-server-input .el-input-group__append .reset-btn) {
    padding: 0;
    border-radius: 0 4px 4px 0;
    flex: 1;
    min-width: 40px;
}

.server-mode-tip {
    margin-left: auto;
}

.main-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.primary-actions-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
}

.primary-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 12px;
}

.ai-seat-action {
    display: flex;
    justify-content: flex-end;
    margin-left: auto;
}

.config-actions-row {
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    gap: 10px 12px;
    width: 100%;
}

.config-section-title {
    align-self: center;
    color: #303133;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
}

.search-keyword-controls,
.search-param-controls {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 6px 8px;
    border: 1px solid #d9e3f0;
    border-radius: 6px;
    background: #f8fbff;
}

.action-button {
    height: 36px;
}

.auto-search-button {
    min-width: 108px;
}

.quick-push-button {
    min-width: 108px;
}

.keyword-settings-button {
    min-width: 116px;
}

.search-param-button {
    min-width: 100px;
}

.keyword-settings-dialog :deep(.el-dialog__body) {
    padding-top: 8px;
}

.search-param-dialog :deep(.el-dialog__body) {
    padding-top: 8px;
}

.keyword-settings-summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: -6px;
}

.keyword-settings-hint {
    color: #606266;
    font-size: 13px;
}

.keyword-settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
}

.search-param-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
}

.search-param-preview {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.keyword-preview-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 220px;
    overflow: auto;
}

.keyword-preview-tag {
    max-width: 100%;
}

.keyword-preview-tag :deep(.el-tag__content) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fuzzy-push-controls {
    display: inline-flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-height: 48px;
    padding: 6px 8px;
    border: 1px solid #d9e3f0;
    border-radius: 6px;
    background: #f8fbff;
}

.fuzzy-section-title {
    align-self: center;
    min-width: 58px;
}

.fuzzy-field {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.fuzzy-field-label {
    color: #606266;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
}

.fuzzy-rule-select-field {
    width: 180px;
}

.fuzzy-count-field {
    width: 132px;
}

.fuzzy-rule-select {
    width: 100%;
}

.fuzzy-count-input {
    width: 100%;
}

.fuzzy-options {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    min-height: 32px;
}

:deep(.fuzzy-options .el-checkbox) {
    margin-right: 0;
}

.fuzzy-push-button {
    align-self: flex-end;
    min-width: 128px;
}

.fuzzy-rule-button {
    align-self: flex-end;
    min-width: 104px;
}

.fuzzy-rule-dialog :deep(.el-dialog__body) {
    padding-top: 8px;
}

.fuzzy-rule-form-grid {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 120px;
    gap: 12px;
}

.fuzzy-rule-form-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
}

.fuzzy-rule-table-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    color: #303133;
    font-weight: 600;
}

.fuzzy-rule-keywords {
    line-height: 1.45;
    word-break: break-word;
}

.action-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 15px;
    line-height: 1;
    white-space: nowrap;
}

.ai-seat-label {
    gap: 8px;
}

.auto-search-tag {
    max-width: min(620px, 100%);
    min-height: 32px;
    height: auto;
    padding: 6px 10px;
    white-space: normal;
    vertical-align: middle;
}

:deep(.auto-search-tag .el-tag__content) {
    white-space: normal;
    line-height: 1.35;
}

@media (max-width: 760px) {
    .primary-actions-row {
        align-items: flex-start;
        flex-direction: column;
    }

    .ai-seat-action {
        justify-content: flex-start;
        margin-left: 0;
    }

    .search-keyword-controls,
    .search-param-controls {
        width: 100%;
    }

    .fuzzy-push-controls {
        width: 100%;
    }

    .fuzzy-rule-form-grid {
        grid-template-columns: 1fr;
    }
}

.demo-link {
    margin-top: 0;
}

.my-header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    gap: 16px;
}

/* 固定位置的停止投递按钮样式 */
.fixed-stop-button {
    position: fixed;
    right: 80px;
    bottom: 80px;
    z-index: 9999;
    background: rgba(255, 255, 255, 0.95);
    padding: 8px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.3);
}

.fixed-stop-button:hover {
    background: rgba(255, 255, 255, 1);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
}

/* 投递记录容器样式 */
.push-records-container {
    margin-bottom: 12px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    overflow: hidden;
    max-width: 400px;
}

.push-records-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
}

.push-records-content {
    max-height: 200px;
    overflow-y: auto;
    padding: 8px;
}

.push-record-item {
    display: flex;
    flex-direction: column;
    margin-bottom: 8px;
    padding: 6px 8px;
    background: rgba(248, 250, 252, 0.8);
    border-radius: 4px;
    border-left: 3px solid #e2e8f0;
    font-size: 12px;
    line-height: 1.4;
}

.push-record-item:last-child {
    margin-bottom: 0;
}

.record-time {
    color: #64748b;
    font-size: 11px;
    margin-bottom: 2px;
}

.record-message {
    color: #334155;
    word-break: break-word;
}

.record-error {
    color: #dc2626;
    border-left-color: #dc2626;
}

.record-warn {
    color: #d97706;
    border-left-color: #d97706;
}

.record-info {
    color: #2563eb;
    border-left-color: #2563eb;
}

.record-debug {
    color: #059669;
    border-left-color: #059669;
}

.record-trace {
    color: #7c3aed;
    border-left-color: #7c3aed;
}

.no-records {
    text-align: center;
    color: #94a3b8;
    font-size: 12px;
    padding: 20px 0;
}

/* 滚动条样式 */
.push-records-content::-webkit-scrollbar {
    width: 4px;
}

.push-records-content::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.05);
    border-radius: 2px;
}

.push-records-content::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
}

.push-records-content::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.3);
}
</style>
