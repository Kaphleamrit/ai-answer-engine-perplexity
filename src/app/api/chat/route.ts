// TODO: Implement the chat API with Groq and web scraping with Cheerio and Puppeteer
// Refer to the Next.js Docs on how to read the Request body: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
// Refer to the Groq SDK here on how to use an LLM: https://www.npmjs.com/package/groq-sdk
// Refer to the Cheerio docs here on how to parse HTML: https://cheerio.js.org/docs/basics/loading
// Refer to Puppeteer docs here: https://pptr.dev/guides/what-is-puppeteer
import Groq from 'groq-sdk';
import * as cheerio from 'cheerio';


const client = new Groq({
  apiKey: process.env['GROQ_API_KEY'], // This is the default and can be omitted
});

const $ = await cheerio.fromURL('https://kaphleyy.netlify.app/');
console.log($('h1').text());


const scrapeURLs = async (text: string) => {
  try {

    const urlRegex = /https?:\/\/[^\s]+/g;
    const urlMatches = text.match(urlRegex);
    if (urlMatches === null || urlMatches.length === 0) {
      return []
    }
    let response = []
    for (let i = 0; i < urlMatches.length; i++) {
      const curr = await fetch(urlMatches[0]);
      response.push(curr)
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const urls = extractUrls(html);
    console.log(urls);
  } catch (error) {
    console.error('Error scraping URLs:', error);
  }
}

export async function POST(req: Request) {
  try {
    let content = await req.json();
    content = content.message


    const res = await client.chat.completions.create({
      messages: [{ role: 'user', content: content }],
      model: 'llama3-8b-8192',
    });
  
    const llmOutput = res.choices[0].message.content;
    console.log(llmOutput)
    return Response.json({ llmOutput });
  } catch (error) {
    console.error(error);
  }
}
