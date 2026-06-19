import { AUTO_SEARCH_CONFIG, AutoSearchConfig } from "../config/autoSearchConfig";

const AUTO_SEARCH_RUNTIME_CONFIG_STORAGE_KEY = 'ai-job:auto-search:runtime-config-v1';
const PARAM_LINE_SPLIT_PATTERN = /[\n\r&]+/;

export interface AutoSearchRuntimeConfigForm {
    baseUrl: string;
    defaultParamsText: string;
    reuseCurrentSearchParams: boolean;
}

const cloneDefaultConfig = (): AutoSearchConfig => ({
    baseUrl: AUTO_SEARCH_CONFIG.baseUrl,
    defaultParams: {...AUTO_SEARCH_CONFIG.defaultParams},
    reuseCurrentSearchParams: AUTO_SEARCH_CONFIG.reuseCurrentSearchParams,
});

export const isValidAutoSearchBaseUrl = (baseUrl: string): boolean => {
    try {
        const url = new URL(baseUrl.trim());
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (error) {
        return false;
    }
}

export const parseAutoSearchDefaultParams = (text: string): Record<string, string> => {
    const params: Record<string, string> = {};
    text.split(PARAM_LINE_SPLIT_PATTERN)
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => {
            const separatorIndex = item.indexOf('=');
            if (separatorIndex <= 0) {
                return;
            }
            const key = item.slice(0, separatorIndex).trim();
            const value = item.slice(separatorIndex + 1).trim();
            if (key && key !== 'query') {
                params[key] = value;
            }
        });
    return params;
}

export const formatAutoSearchDefaultParams = (params: Record<string, string>): string => {
    return Object.entries(params)
        .filter(([key]) => key !== 'query')
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
}

export const normalizeAutoSearchRuntimeConfig = (config: Partial<AutoSearchConfig>): AutoSearchConfig => {
    const defaultConfig = cloneDefaultConfig();
    const baseUrl = typeof config.baseUrl === 'string' && isValidAutoSearchBaseUrl(config.baseUrl)
        ? config.baseUrl.trim()
        : defaultConfig.baseUrl;
    const defaultParams = Object.entries(config.defaultParams || {})
        .reduce<Record<string, string>>((result, [key, value]) => {
            const normalizedKey = key.trim();
            if (normalizedKey && normalizedKey !== 'query') {
                result[normalizedKey] = String(value).trim();
            }
            return result;
        }, {});

    return {
        baseUrl,
        defaultParams,
        reuseCurrentSearchParams: typeof config.reuseCurrentSearchParams === 'boolean'
            ? config.reuseCurrentSearchParams
            : defaultConfig.reuseCurrentSearchParams,
    };
}

export const readAutoSearchRuntimeConfig = (): AutoSearchConfig => {
    const rawConfig = localStorage.getItem(AUTO_SEARCH_RUNTIME_CONFIG_STORAGE_KEY);
    if (!rawConfig) {
        return cloneDefaultConfig();
    }
    try {
        return normalizeAutoSearchRuntimeConfig(JSON.parse(rawConfig));
    } catch (error) {
        localStorage.removeItem(AUTO_SEARCH_RUNTIME_CONFIG_STORAGE_KEY);
        return cloneDefaultConfig();
    }
}

export const saveAutoSearchRuntimeConfig = (config: AutoSearchConfig): AutoSearchConfig => {
    const normalizedConfig = normalizeAutoSearchRuntimeConfig(config);
    localStorage.setItem(AUTO_SEARCH_RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(normalizedConfig));
    return normalizedConfig;
}

export const resetAutoSearchRuntimeConfig = (): AutoSearchConfig => {
    const defaultConfig = cloneDefaultConfig();
    localStorage.setItem(AUTO_SEARCH_RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(defaultConfig));
    return defaultConfig;
}

export const buildAutoSearchRuntimeConfigForm = (config: AutoSearchConfig): AutoSearchRuntimeConfigForm => ({
    baseUrl: config.baseUrl,
    defaultParamsText: formatAutoSearchDefaultParams(config.defaultParams),
    reuseCurrentSearchParams: config.reuseCurrentSearchParams,
});
