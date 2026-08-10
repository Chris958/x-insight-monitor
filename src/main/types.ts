export type PostType = 'original' | 'quote' | 'reply' | 'repost';
export type Verdict = '支持' | '部分支持' | '反驳' | '证据不足' | '不适用';

export interface AppSettings {
  pollIntervalSec: number;
  openaiBaseUrl: string;
  translationModel: string;
  analysisModel: string;
  timezone: string;
  autoStart: boolean;
  launchMinimized: boolean;
  includeReplies: boolean;
  includeReposts: boolean;
  dailyModelLimit: number;
  maxAccounts: number;
}

export interface SecretSettings {
  openaiApiKey: string;
  wecomWebhookUrl: string;
  xCookieHeader: string;
  xAccountAlias: string;
}

export interface MonitorAccount {
  id: string; username: string; displayName: string; enabled: boolean;
  includeReplies: boolean; includeReposts: boolean; includeQuotes: boolean;
  intervalSec: number; lastSeenPostId?: string; lastSuccessAt?: string;
  nextPollAt?: string; consecutiveFailures: number; error?: string;
}

export interface XPost {
  source: 'twscrape' | 'official_x'; postId: string; authorId: string;
  username: string; displayName?: string; text: string; language?: string;
  publishedAt: string; url: string; postType: PostType;
  quotedPost?: { postId: string; url: string; text?: string };
  repliedToPost?: { postId: string; url: string };
  media: Array<{ type: 'image' | 'video' | 'gif'; url: string }>;
  metrics?: { likes?: number; replies?: number; reposts?: number; views?: number };
}

export interface Translation { language: string; summaryZh: string; translatedText: string; uncertainTerms: string[]; }
export interface Claim { id: string; type: 'FACT' | 'NUMERIC_FACT' | 'OPINION' | 'PREDICTION' | 'OTHER'; claim: string; metric: string; value: string; unit: string; timeScope: string; geography: string; missingContext: string[]; }
export interface LogicAnalysis { conclusion: string; explicitPremises: string[]; implicitAssumptions: string[]; reasoningGaps: string[]; alternativeExplanations: string[]; validityConditions: string[]; }
export interface Evidence { title: string; url: string; publisher: string; snippet: string; grade: 'A'|'B'|'C'|'D'; }
export interface ClaimResult { claimId: string; verdict: Verdict; confidence: '高'|'中'|'低'; rationale: string; evidence: Evidence[]; }

export interface StoredPost extends XPost {
  id: string; discoveredAt: string; status: string; translation?: Translation;
  logic?: LogicAnalysis; claims?: Claim[]; claimResults?: ClaimResult[];
  overallResult?: string; limitations?: string[]; error?: string;
  flashSentAt?: string; reportSentAt?: string;
}

export interface AppLog { id: string; at: string; level: 'info'|'warn'|'error'; component: string; message: string; }
export interface AppData { version: 1; settings: AppSettings; accounts: MonitorAccount[]; posts: StoredPost[]; logs: AppLog[]; usage: Record<string, number>; }
export interface RuntimeStatus { running: boolean; collector: 'unknown'|'healthy'|'error'; configured: boolean; lastCycleAt?: string; activeJobs: number; }

export const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalSec: 60, openaiBaseUrl: 'https://api.openai.com/v1',
  translationModel: 'gpt-5.6-luna', analysisModel: 'gpt-5.6',
  timezone: 'Asia/Shanghai', autoStart: false, launchMinimized: false,
  includeReplies: false, includeReposts: false, dailyModelLimit: 200, maxAccounts: 20
};
