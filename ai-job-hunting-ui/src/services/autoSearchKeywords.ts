import { AUTO_SEARCH_KEYWORDS } from "../config/autoSearchKeywords";

const AUTO_SEARCH_KEYWORDS_STORAGE_KEY = 'ai-job:auto-search:keywords-v1';
const KEYWORD_SPLIT_PATTERN = /[\n\r,，;；、]+/;

export const isInvalidAutoSearchKeyword = (keyword: string): boolean => {
    return /^https?:\/\//.test(keyword)
        || keyword.includes('/@fs/')
        || keyword.length > 120;
}

export const splitAutoSearchKeywordText = (text: string): string[] => {
    return text.split(KEYWORD_SPLIT_PATTERN);
}

export const sanitizeAutoSearchKeywords = (keywords: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    keywords
        .map(item => item.trim())
        .filter(item => !!item && !isInvalidAutoSearchKeyword(item))
        .forEach(item => {
            const key = item.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                result.push(item);
            }
        });
    return result;
}

export const readAutoSearchKeywords = (): string[] => {
    const rawKeywords = localStorage.getItem(AUTO_SEARCH_KEYWORDS_STORAGE_KEY);
    if (!rawKeywords) {
        return sanitizeAutoSearchKeywords(AUTO_SEARCH_KEYWORDS);
    }
    try {
        const parsedKeywords = JSON.parse(rawKeywords);
        if (!Array.isArray(parsedKeywords)) {
            localStorage.removeItem(AUTO_SEARCH_KEYWORDS_STORAGE_KEY);
            return sanitizeAutoSearchKeywords(AUTO_SEARCH_KEYWORDS);
        }
        return sanitizeAutoSearchKeywords(parsedKeywords.map(item => String(item)));
    } catch (error) {
        localStorage.removeItem(AUTO_SEARCH_KEYWORDS_STORAGE_KEY);
        return sanitizeAutoSearchKeywords(AUTO_SEARCH_KEYWORDS);
    }
}

export const saveAutoSearchKeywords = (keywords: string[]): string[] => {
    const normalizedKeywords = sanitizeAutoSearchKeywords(keywords);
    localStorage.setItem(AUTO_SEARCH_KEYWORDS_STORAGE_KEY, JSON.stringify(normalizedKeywords));
    return normalizedKeywords;
}

export const resetAutoSearchKeywords = (): string[] => {
    const defaultKeywords = sanitizeAutoSearchKeywords(AUTO_SEARCH_KEYWORDS);
    localStorage.setItem(AUTO_SEARCH_KEYWORDS_STORAGE_KEY, JSON.stringify(defaultKeywords));
    return defaultKeywords;
}

export const formatAutoSearchKeywords = (keywords: string[]): string => {
    return sanitizeAutoSearchKeywords(keywords).join('\n');
}
