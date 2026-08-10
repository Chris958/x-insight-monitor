import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficialXClient } from './official-x.js';

afterEach(() => vi.unstubAllGlobals());

describe('OfficialXClient', () => {
  it('uses a bearer token and maps official API posts', async () => {
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({data:{id:'42',username:'Investor',name:'Investor Name'}}),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:'100',text:'Short text',note_tweet:{text:'Long 😆 text'},created_at:'2026-08-10T01:02:03.000Z',lang:'en',referenced_tweets:[{type:'quoted',id:'99'}],attachments:{media_keys:['3_1']},public_metrics:{like_count:7,reply_count:2,retweet_count:3,impression_count:90}}],includes:{tweets:[{id:'99',text:'Quoted text'}],media:[{media_key:'3_1',type:'photo',url:'https://pbs.twimg.com/media/a.jpg'}]}}),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    const posts=await new OfficialXClient('secret-token').fetch('@Investor',10,'98');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/2/users/42/tweets?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('since_id=98');
    expect(posts).toEqual([expect.objectContaining({source:'official_x',postId:'100',username:'Investor',text:'Long 😆 text',postType:'quote'})]);
    expect(posts[0].media).toEqual([{type:'image',url:'https://pbs.twimg.com/media/a.jpg'}]);
    expect(posts[0].quotedPost?.text).toBe('Quoted text');
  });

  it('surfaces authentication errors without exposing the token', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({title:'Unauthorized',detail:'Invalid token'}),{status:401,headers:{'content-type':'application/json'}})));
    const message=await new OfficialXClient('do-not-leak').health().then(()=>'',error=>error instanceof Error?error.message:String(error));
    expect(message).toContain('HTTP 401');
    expect(message).not.toContain('do-not-leak');
  });
});
