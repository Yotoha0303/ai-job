export interface FuzzyPushKeywordRule {
    id: string;
    seedKeyword: string;
    expandedKeywords: string[];
    enabled: boolean;
    updatedAt: number;
}

export const DEFAULT_FUZZY_PUSH_KEYWORD_RULES: FuzzyPushKeywordRule[] = [
    {
        id: 'default-岗位',
        seedKeyword: '岗位种子',
        expandedKeywords: ['种子1', '种子2', '种子3',],
        enabled: true,
        updatedAt: 0,
    },
];
