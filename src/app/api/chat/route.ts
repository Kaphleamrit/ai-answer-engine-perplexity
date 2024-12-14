import Groq from "groq-sdk";
import * as cheerio from "cheerio";
import axios from "axios";



const client = new Groq({
  apiKey: process.env["GROQ_API_KEY"],
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
      try {
        const searchURL = `https://www.google.com/search?q=${encodeURIComponent(question)}`;
        const { data: html } = await axios.get(searchURL, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
          },
        });

        const $ = cheerio.load(html);
        const results: string[] = [];
        $("a").each((_, element) => {
          const link = $(element).attr("href");
          const title = $(element).text().trim();

          if (link && link.startsWith("/url?q=")) {
            const url = link.split("/url?q=")[1].split("&")[0];
            if (url) {
              results.push(url);
            }
          }

          if (results.length >= 5) return false;
        });

        for (let url of results) {
          scrapedArray.push(await scrapePage(url));
        }
      } catch (error) {
        console.error(error);
      }
    }
    const prompt = `
        You are an AI assistant. You have been provided with the following data, scraped from various websites:

        ${scrapedArray.join("\n\n")}

        with URLs: ${urls}. Also you are an academic expert, you always cite your sources and base your response only on the
        context that you have been provided.

        Please answer the question: ${question}
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
