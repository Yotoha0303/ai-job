import {
    DEFAULT_FUZZY_PUSH_KEYWORD_RULES,
    FuzzyPushKeywordRule,
} from "../config/fuzzyPushDefaultRules";

const FUZZY_PUSH_RULES_STORAGE_KEY = 'ai-job:fuzzy-push:keyword-rules-v1';
const KEYWORD_SPLIT_PATTERN = /[\n\r,，;；、]+/;

const cloneRules = (rules: FuzzyPushKeywordRule[]): FuzzyPushKeywordRule[] => {
    return rules.map(rule => ({
        ...rule,
        expandedKeywords: [...rule.expandedKeywords],
    }));
}

export const isInvalidFuzzyPushKeyword = (keyword: string): boolean => {
    return /^https?:\/\//.test(keyword)
        || keyword.includes('/@fs/')
        || keyword.length > 120;
}

export const splitFuzzyPushKeywordText = (text: string): string[] => {
    return text.split(KEYWORD_SPLIT_PATTERN);
}

export const sanitizeFuzzyPushKeywords = (keywords: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    keywords
        .map(item => item.trim())
        .filter(item => !!item && !isInvalidFuzzyPushKeyword(item))
        .forEach(item => {
            const key = item.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                result.push(item);
            }
        });
    return result;
}

const normalizeRule = (rule: Partial<FuzzyPushKeywordRule>): FuzzyPushKeywordRule | null => {
    const seedKeyword = String(rule.seedKeyword || '').trim();
    const expandedKeywords = sanitizeFuzzyPushKeywords(rule.expandedKeywords || []);
    if (!seedKeyword || isInvalidFuzzyPushKeyword(seedKeyword) || expandedKeywords.length === 0) {
        return null;
    }
    return {
        id: String(rule.id || createFuzzyPushKeywordRuleId()),
        seedKeyword,
        expandedKeywords,
        enabled: rule.enabled !== false,
        updatedAt: Number(rule.updatedAt) || Date.now(),
    };
}

const normalizeRules = (rules: Partial<FuzzyPushKeywordRule>[]): FuzzyPushKeywordRule[] => {
    const seenSeeds = new Set<string>();
    const normalizedRules: FuzzyPushKeywordRule[] = [];
    rules.forEach(rule => {
        const normalizedRule = normalizeRule(rule);
        if (!normalizedRule) {
            return;
        }
        const seedKey = normalizedRule.seedKeyword.toLowerCase();
        if (!seenSeeds.has(seedKey)) {
            seenSeeds.add(seedKey);
            normalizedRules.push(normalizedRule);
        }
    });
    return normalizedRules;
}

export const getDefaultFuzzyPushKeywordRules = (): FuzzyPushKeywordRule[] => {
    return cloneRules(DEFAULT_FUZZY_PUSH_KEYWORD_RULES);
}

export const readFuzzyPushKeywordRules = (): FuzzyPushKeywordRule[] => {
    const rawRules = localStorage.getItem(FUZZY_PUSH_RULES_STORAGE_KEY);
    if (!rawRules) {
        return getDefaultFuzzyPushKeywordRules();
    }
    try {
        const parsedRules = JSON.parse(rawRules);
        if (!Array.isArray(parsedRules)) {
            localStorage.removeItem(FUZZY_PUSH_RULES_STORAGE_KEY);
            return getDefaultFuzzyPushKeywordRules();
        }
        return normalizeRules(parsedRules);
    } catch (error) {
        localStorage.removeItem(FUZZY_PUSH_RULES_STORAGE_KEY);
        return getDefaultFuzzyPushKeywordRules();
    }
}

export const saveFuzzyPushKeywordRules = (rules: FuzzyPushKeywordRule[]): FuzzyPushKeywordRule[] => {
    const normalizedRules = normalizeRules(rules);
    localStorage.setItem(FUZZY_PUSH_RULES_STORAGE_KEY, JSON.stringify(normalizedRules));
    return normalizedRules;
}

export const resetFuzzyPushKeywordRules = (): FuzzyPushKeywordRule[] => {
    const defaultRules = getDefaultFuzzyPushKeywordRules();
    localStorage.setItem(FUZZY_PUSH_RULES_STORAGE_KEY, JSON.stringify(defaultRules));
    return defaultRules;
}

export const createFuzzyPushKeywordRuleId = (): string => {
    return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const formatFuzzyPushRuleKeywords = (rule: FuzzyPushKeywordRule): string => {
    return rule.expandedKeywords.join('\n');
}

const buildGenericFuzzyPushKeywords = (keyword: string): string[] => {
    const trimmedKeyword = keyword.trim();
    const lowerKeyword = trimmedKeyword.toLowerCase();
    return [
        trimmedKeyword,
        trimmedKeyword.includes("工程师") ? trimmedKeyword : `${trimmedKeyword}工程师`,
        trimmedKeyword.includes("开发") ? trimmedKeyword : `${trimmedKeyword}开发`,
        trimmedKeyword.includes("后端") ? "后端开发" : "",
        trimmedKeyword.includes("后端") ? "后端工程师" : "",
        lowerKeyword.includes("java") ? "Spring Boot" : "",
        lowerKeyword.includes("java") ? "微服务开发" : "",
        lowerKeyword.includes("go") || lowerKeyword.includes("golang") ? "Golang" : "",
        lowerKeyword.includes("go") || lowerKeyword.includes("golang") ? "云原生开发" : "",
    ];
}

export const buildFuzzyPushRuleKeywords = (rule: FuzzyPushKeywordRule): string[] => {
    const seedKey = rule.seedKeyword.trim().toLowerCase();
    const expandedKeywords = sanitizeFuzzyPushKeywords(rule.expandedKeywords);
    const similarKeywords = expandedKeywords.filter(item => item.toLowerCase() !== seedKey);
    return similarKeywords.length > 0 ? similarKeywords : expandedKeywords;
}

export const buildFuzzyPushKeywords = (
    keyword: string,
    rules: FuzzyPushKeywordRule[] = readFuzzyPushKeywordRules()
): string[] => {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
        return [];
    }
    const lowerKeyword = trimmedKeyword.toLowerCase();
    const matchedRule = rules.find(rule => rule.enabled && rule.seedKeyword.trim().toLowerCase() === lowerKeyword);
    if (matchedRule) {
        return buildFuzzyPushRuleKeywords(matchedRule);
    }
    const expandedKeywords = sanitizeFuzzyPushKeywords(
        buildGenericFuzzyPushKeywords(trimmedKeyword)
    );
    const similarKeywords = expandedKeywords.filter(item => item.toLowerCase() !== lowerKeyword);
    return similarKeywords.length > 0 ? similarKeywords : expandedKeywords;
}
