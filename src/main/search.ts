import { Evidence } from './types.js';

const PRIMARY_DOMAINS = ['.gov','.gov.cn','.europa.eu','sec.gov','stats.gov','who.int','worldbank.org','imf.org','oecd.org','arxiv.org','doi.org'];
const SECONDARY_DOMAINS = ['reuters.com','apnews.com','ft.com','bloomberg.com','nature.com','science.org'];

function decodeEntities(value: string) { return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function grade(url: string): Evidence['grade'] { try { const h = new URL(url).hostname.toLowerCase(); return PRIMARY_DOMAINS.some(d => h.endsWith(d)) ? 'A' : SECONDARY_DOMAINS.some(d => h.endsWith(d)) ? 'B' : 'C'; } catch { return 'D'; } }

export class SearchClient {
  async search(query: string, limit = 5): Promise<Evidence[]> {
    const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(target, { headers:{'user-agent':'Mozilla/5.0 (compatible; XInsightMonitor/0.1)','accept-language':'en-US,en;q=0.8'} });
    if (!response.ok) throw new Error(`免费检索暂不可用 (${response.status})`);
    const html = await response.text(); const results: Evidence[] = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    for (const match of html.matchAll(re)) {
      let url = decodeEntities(match[1]);
      try { const u = new URL(url, 'https://duckduckgo.com'); const uddg = u.searchParams.get('uddg'); if (uddg) url = decodeURIComponent(uddg); } catch { continue; }
      if (!/^https?:\/\//.test(url)) continue;
      const title = decodeEntities(match[2]); const snippet = decodeEntities(match[3]);
      results.push({ title, url, publisher: new URL(url).hostname, snippet, grade: grade(url) });
      if (results.length >= limit) break;
    }
    return results;
  }
}
