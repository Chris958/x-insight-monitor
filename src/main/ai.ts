import { Evidence, InvestmentReview, Translation } from './types.js';

type JsonSchema = Record<string, unknown>;

const translationSchema: JsonSchema = {
  type:'object', additionalProperties:false,
  properties:{
    language:{type:'string'}, summaryZh:{type:'string'}, translatedText:{type:'string'},
    uncertainTerms:{type:'array',items:{type:'string'},maxItems:5},
    searchQueries:{type:'array',items:{type:'string'},minItems:1,maxItems:2}
  },
  required:['language','summaryZh','translatedText','uncertainTerms','searchQueries']
};

const industrySchema = {
  type:'object', additionalProperties:false,
  properties:{ name:{type:'string'}, rationale:{type:'string'} },
  required:['name','rationale']
};

const companySchema = {
  type:'object', additionalProperties:false,
  properties:{
    name:{type:'string'}, ticker:{type:'string'}, market:{type:'string'},
    rationale:{type:'string'}, confidence:{type:'string',enum:['高','中','低']}
  },
  required:['name','ticker','market','rationale','confidence']
};

const reviewSchema: JsonSchema = {
  type:'object', additionalProperties:false,
  properties:{
    coreViewpoint:{type:'string'},
    verdict:{type:'string',enum:['可信','部分可信','不可信','证据不足']},
    verification:{type:'string'},
    beneficiaryIndustries:{type:'array',items:industrySchema,maxItems:3},
    beneficiaryCompanies:{type:'array',items:companySchema,maxItems:5},
    risks:{type:'array',items:{type:'string'},maxItems:3},
    evidenceIndexes:{type:'array',items:{type:'integer'},maxItems:3}
  },
  required:['coreViewpoint','verdict','verification','beneficiaryIndustries','beneficiaryCompanies','risks','evidenceIndexes']
};

type ReviewDraft = Omit<InvestmentReview, 'evidence'> & { evidenceIndexes: number[] };

export class AiClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  async translate(model: string, text: string): Promise<Translation> {
    return this.structured<Translation>(model, 'investment_translation_v2', translationSchema,
      '你是财经信息编辑。提炼帖子唯一最核心的投资观点，summaryZh不超过80个汉字；将原文准确翻译成简体中文。保留数字、单位、公司、股票代码和URL，不补充原文没有的信息。若原文已是中文，translatedText保持原文。再生成1至2条用于核查核心观点并寻找直接受益行业和上市公司的精确网页检索词。不要拆解边缘事实。', text, 1800);
  }

  async reviewInvestment(model: string, translation: Translation, evidence: Evidence[]): Promise<InvestmentReview> {
    const candidates = evidence.map((item,index) => `[${index}] ${item.title}\n发布者:${item.publisher}\n摘要:${item.snippet}\nURL:${item.url}`).join('\n\n');
    const result = await this.structured<ReviewDraft>(model, 'investment_review_v2', reviewSchema,
      '你是面向二级市场的精简投资信息核查员。只审查帖子唯一的核心观点，不罗列次要事实，不复述全文，不输出推理过程。verification不超过160个汉字，直接说明观点是否成立及关键依据。最多列3个直接受益行业和5家上市公司；公司必须写真实名称、股票代码和市场，说明受益链条，按证据确定性标高/中/低。无法确认主营或受益关系时不要列出，禁止凑数。最多列3条会使逻辑失效的关键风险。事实核查只能依据候选证据；证据不足必须明确标记。只引用真正支撑结论的最多3条证据。',
      `核心观点：${translation.summaryZh}\n\n中文内容：${translation.translatedText}\n\n候选证据：\n${candidates || '无可用外部证据'}`, 1800);
    return {
      coreViewpoint:result.coreViewpoint,
      verdict:result.verdict,
      verification:result.verification,
      beneficiaryIndustries:result.beneficiaryIndustries,
      beneficiaryCompanies:result.beneficiaryCompanies,
      risks:result.risks,
      evidence:result.evidenceIndexes.filter(index => Number.isInteger(index) && evidence[index]).map(index => evidence[index])
    };
  }

  async test(model: string) { return this.translate(model, 'The system is ready.'); }

  private async structured<T>(model: string, name: string, schema: JsonSchema, instructions: string, input: string, maxOutputTokens: number): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/responses`;
    const response = await fetch(url, {
      method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${this.apiKey}`},
      body:JSON.stringify({model,store:false,instructions,input,text:{format:{type:'json_schema',name,strict:true,schema}},max_output_tokens:maxOutputTokens})
    });
    if (!response.ok) throw new Error(`模型接口错误 ${response.status}: ${(await response.text()).slice(0,500)}`);
    const body = await response.json() as any;
    const outputText = body.output_text || body.output?.flatMap((item:any) => item.content || []).find((item:any) => item.type === 'output_text')?.text || body.choices?.[0]?.message?.content;
    if (!outputText) throw new Error('模型接口未返回可解析内容');
    try { return JSON.parse(outputText) as T; } catch { throw new Error('模型返回内容不是有效 JSON'); }
  }
}
