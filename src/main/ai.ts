import { Claim, ClaimResult, Evidence, LogicAnalysis, Translation } from './types.js';

type JsonSchema = Record<string, unknown>;

const translationSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: { language: { type: 'string' }, summaryZh: { type: 'string' }, translatedText: { type: 'string' }, uncertainTerms: { type: 'array', items: { type: 'string' } } },
  required: ['language','summaryZh','translatedText','uncertainTerms']
};

const stringArray = { type: 'array', items: { type: 'string' } };
const analysisSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    logic: { type: 'object', additionalProperties: false, properties: { conclusion:{type:'string'}, explicitPremises:stringArray, implicitAssumptions:stringArray, reasoningGaps:stringArray, alternativeExplanations:stringArray, validityConditions:stringArray }, required:['conclusion','explicitPremises','implicitAssumptions','reasoningGaps','alternativeExplanations','validityConditions'] },
    claims: { type: 'array', items: { type:'object', additionalProperties:false, properties:{ type:{type:'string',enum:['FACT','NUMERIC_FACT','OPINION','PREDICTION','OTHER']}, claim:{type:'string'}, metric:{type:'string'}, value:{type:'string'}, unit:{type:'string'}, timeScope:{type:'string'}, geography:{type:'string'}, missingContext:stringArray }, required:['type','claim','metric','value','unit','timeScope','geography','missingContext'] } },
    overallResult: {type:'string'}, limitations: stringArray
  }, required:['logic','claims','overallResult','limitations']
};

const verificationSchema: JsonSchema = {
  type:'object', additionalProperties:false,
  properties:{ verdict:{type:'string',enum:['支持','部分支持','反驳','证据不足','不适用']}, confidence:{type:'string',enum:['高','中','低']}, rationale:{type:'string'}, evidenceIndexes:{type:'array',items:{type:'integer'}} },
  required:['verdict','confidence','rationale','evidenceIndexes']
};

export class AiClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  async translate(model: string, text: string): Promise<Translation> {
    return this.structured<Translation>(model, 'translation_v1', translationSchema,
      '你是严谨的财经与公共信息翻译。将帖子翻译为简体中文并生成不超过80字摘要。严格保留数字、单位、人名、机构、股票代码、标签和URL；不得补充原文没有的信息。若原文已是中文，translatedText保持原文。', text);
  }

  async analyze(model: string, original: string, translation: string): Promise<{logic: LogicAnalysis; claims: Claim[]; overallResult: string; limitations: string[]}> {
    const result = await this.structured<Omit<{logic: LogicAnalysis; claims: Claim[]; overallResult: string; limitations: string[]}, never>>(model, 'analysis_v1', analysisSchema,
      '分析X帖子。区分可验证事实、数值事实、观点、预测和其他。复合主张必须原子化。观点只分析前提、推理、假设、逻辑风险与替代解释，不判真假。数值主张提取指标、值、单位、时间、地区及缺失口径。不得猜测作者动机。', `原文：\n${original}\n\n中文参考翻译：\n${translation}`);
    return { ...result, claims: result.claims.map(c => ({ ...c, id: crypto.randomUUID() })) };
  }

  async verify(model: string, claim: Claim, evidence: Evidence[]): Promise<ClaimResult> {
    if (claim.type === 'OPINION' || claim.type === 'PREDICTION' || claim.type === 'OTHER') return { claimId: claim.id, verdict: '不适用', confidence: '高', rationale: '该内容不是可由当前外部证据判定真假的事实主张。', evidence: [] };
    const candidates = evidence.map((e,i) => `[${i}] ${e.title}\n发布者:${e.publisher}\n摘要:${e.snippet}\nURL:${e.url}`).join('\n\n');
    const result = await this.structured<{verdict: ClaimResult['verdict']; confidence: ClaimResult['confidence']; rationale: string; evidenceIndexes: number[]}>(model, 'verification_v1', verificationSchema,
      '只根据给定候选证据核查主张。不可使用模型记忆或编造来源。检查数字的时间、地区、单位、分母、同比/环比与名义/实际口径。证据不足就明确输出证据不足。', `主张：${claim.claim}\n\n候选证据：\n${candidates || '无'}`);
    return { claimId: claim.id, verdict: result.verdict, confidence: result.confidence, rationale: result.rationale, evidence: result.evidenceIndexes.filter(i => Number.isInteger(i) && evidence[i]).map(i => evidence[i]) };
  }

  async test(model: string) { return this.translate(model, 'The system is ready.'); }

  private async structured<T>(model: string, name: string, schema: JsonSchema, instructions: string, input: string): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/responses`;
    const response = await fetch(url, { method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${this.apiKey}`}, body:JSON.stringify({ model, store:false, instructions, input, text:{format:{type:'json_schema',name,strict:true,schema}}, max_output_tokens:5000 }) });
    if (!response.ok) throw new Error(`模型接口错误 ${response.status}: ${(await response.text()).slice(0,500)}`);
    const body = await response.json() as any;
    const outputText = body.output_text || body.output?.flatMap((o:any) => o.content || []).find((c:any) => c.type === 'output_text')?.text || body.choices?.[0]?.message?.content;
    if (!outputText) throw new Error('模型接口未返回可解析内容');
    try { return JSON.parse(outputText) as T; } catch { throw new Error('模型返回内容不是有效 JSON'); }
  }
}
