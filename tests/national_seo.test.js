'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {HTML}=require('../national/ui');
const seo=require('../national/seo');

test('homepage has canonical metadata, useful search title and structured data',()=>{
 assert.match(HTML,/Water Quality by Address: What Is in My Tap Water\?/);
 assert.match(HTML,/rel="canonical" href="https:\/\/www\.ismywaterok\.com\//);
 assert.match(HTML,/application\/ld\+json/);
 assert.match(HTML,/"@type":"WebSite"/);
 assert.match(HTML,/"@type":"WebApplication"/);
 assert.match(HTML,/water-quality-by-address/);
 assert.match(HTML,/private-well-water-testing/);
});

test('robots and sitemap expose useful pages while blocking APIs and household detail pages',()=>{
 const robots=seo.robots();
 assert.match(robots,/Disallow: \/api\//);
 assert.match(robots,/Disallow: \/water-details/);
 assert.match(robots,/Sitemap: https:\/\/www\.ismywaterok\.com\/sitemap\.xml/);
 const sitemap=seo.sitemap();
 assert.match(sitemap,/https:\/\/www\.ismywaterok\.com\/water-quality-by-address/);
 assert.match(sitemap,/https:\/\/www\.ismywaterok\.com\/lead-in-drinking-water/);
 assert.doesNotMatch(sitemap,/water-details/);
});

test('SEO guide pages are substantive and unique, not doorway pages',()=>{
 const paths=seo.guidePaths();
 assert.ok(paths.length>=8);
 const titles=new Set();
 for(const path of paths){
  const html=seo.guideHtml(path);
  assert.ok(html.length>2500,path);
  assert.ok(html.includes('<link rel="canonical" href="https://www.ismywaterok.com'+path+'">'),path);
  assert.match(html,/Check your own address/);
  assert.match(html,/application\/ld\+json/);
  const title=html.match(/<title>(.*?)<\/title>/)?.[1];
  assert.ok(title);
  assert.equal(titles.has(title),false,'duplicate guide title');
  titles.add(title);
 }
});
