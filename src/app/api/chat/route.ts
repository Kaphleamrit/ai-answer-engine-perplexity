// TODO: Implement the chat API with Groq and web scraping with Cheerio and Puppeteer
// Refer to the Next.js Docs on how to read the Request body: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
// Refer to the Groq SDK here on how to use an LLM: https://www.npmjs.com/package/groq-sdk
// Refer to the Cheerio docs here on how to parse HTML: https://cheerio.js.org/docs/basics/loading
// Refer to Puppeteer docs here: https://pptr.dev/guides/what-is-puppeteer
import Groq from "groq-sdk";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer"; 

const client = new Groq({
  apiKey: process.env["GROQ_API_KEY"], // This is the default and can be omitted
});

const scrapePage = async (url: string) => {
  const $ = await cheerio.fromURL(url);
  let text = $("body").text();
  const trimmedText = text.replace(/\s+/g, " ");
  return trimmedText;
};

const getURL = (llmInput: string) => {
  try {
    const urlRegex = "/https?:\/\/[^\s]+/g";
    const urlMatches = llmInput.match(urlRegex);

    if (urlMatches && urlMatches.length > 0) {
      return urlMatches;
    } else {
      return null;
    }
  } catch (error) {
    console.error(error);
  }
};

const getQuestion = (llmInput: string) => {
  return llmInput.replace("/https?:\/\/[^\s]+/g", "");
};

//puppeteer
// const googleSearch = async (query: string) => {
//   const browser = await puppeteer.launch();
//   const page = await browser.newPage();

//   await page.goto("https://www.google.com", { waitUntil: "networkidle2" });

//   await page.type('input[name="q"]', query);

//   await Promise.all([
//     page.keyboard.press("Enter"),
//     page.waitForNavigation({ waitUntil: "networkidle2" }),
//   ]);

//   const results = await page.$$eval(".tF2C", els =>
//     els.slice(0, 5).map(el => {
//       const titleEl = el.querySelector("h3");
//       const linkEl = el.querySelector("a");
//       return {
//         title: titleEl ? titleEl.innerText : null,
//         link: linkEl ? linkEl.href : null,
//       };
//     })
//   );
//   console.log("Top 5 Results:");
//   console.log(results);
//   await browser.close();
//   return results;
// };

export async function POST(req: Request) {
  try {
    let llmInput = await req.json();
    llmInput = llmInput.message;
    let scrapedArray = [];
    let urls = getURL(llmInput);
    const question = getQuestion(llmInput);
    if (urls) {
      for (let url of urls) {
        scrapedArray.push(await scrapePage(url));
      }
    } else {
      // TODO: Handle the case where no URL is f
    // ound(google search)
      // await googleSearch(llmInput);
      scrapedArray.push("This feature is coming soon!");
    }
    const prompt = `
        You are an AI assistant. You have been provided with the following data, scraped from various websites:

        ${scrapedArray.join("\n\n")}

        Your task is to answer the question solely based on the provided data. 
        Do not invent information that is not present in the data.
        If the data does not contain enough information to answer the question accurately, 
        state that you do not have sufficient information.
        `;
    const res = await client.chat.completions.create({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: question },
      ],
      model: "llama3-8b-8192",
    });

    const llmOutput = res.choices[0].message.content;
    return Response.json({ llmOutput });
  } catch (error) {
    console.error(error);
  }
}
