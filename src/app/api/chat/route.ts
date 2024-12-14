import Groq from "groq-sdk";
import * as cheerio from "cheerio";
import axios from "axios";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const client = new Groq({
  apiKey: process.env["GROQ_API_KEY"],
});

// Token limit for the model
const TOKEN_LIMIT = 30000;

// Scrape page with caching
const scrapePage = async (url: string) => {
  try {
    const cachedContent = await redis.get(`scraped:${url}`);
    if (cachedContent) {
      console.log(`Cache hit for URL: ${url}`);
      return cachedContent;
    }

    const { data: html } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
      },
    });
    const $ = cheerio.load(html);
    const text = $("body").text();
    const trimmedText = text.replace(/\s+/g, " ").trim();

    await redis.set(`scraped:${url}`, trimmedText, { ex: 3600 }); // Cache for 1 hour
    console.log(`Cache miss. Scraped and stored URL: ${url}`);
    return trimmedText;
  } catch (error) {
    console.error(`Error scraping URL: ${url}`, error);
    throw error;
  }
};

// Extract URLs from input
const getURL = (llmInput: string) => {
  const urlRegex = /https?:\/\/[^\s]+/g;
  return llmInput.match(urlRegex) || null;
};

// Extract question from input (removes URLs)
const getQuestion = (llmInput: string) => {
  return llmInput.replace(/https?:\/\/[^\s]+/g, "").trim();
};

// Function to truncate conversation history to stay within token limits
const truncateConversationHistory = (
  conversationHistory: { role: string; content: string }[],
  maxTokens: number
) => {
  let tokenCount = 0;
  const truncatedHistory = [];

  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const message = conversationHistory[i];
    const tokens = message.content.length; // Approximate token count
    if (tokenCount + tokens > maxTokens) break;

    truncatedHistory.unshift(message);
    tokenCount += tokens;
  }

  return truncatedHistory;
};

// Handle POST request
export async function POST(req: Request) {
  try {
    const llmInput = await req.json();
    const { message, conversationId } = llmInput;

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required." }), {
        status: 400,
      });
    }

    const question = getQuestion(message);
    const urls = getURL(message);

    // Fetch or initialize conversation
    const conversationKey = `conversation:${conversationId || "default"}`;
    const cachedConversation = await redis.get(conversationKey);

    // Validate and parse the cached conversation data
    let conversationHistory = [];
    if (cachedConversation) {
      try {
        conversationHistory = JSON.parse(cachedConversation);
        console.log(`Cache hit for conversation ID: ${conversationId}`);
      } catch (error) {
        console.error(
          `Error parsing cached conversation for ID: ${conversationId}`
        );
        conversationHistory = [];
      }
    }

    let scrapedArray = [];
    if (urls) {
      for (const url of urls) {
        const scrapedContent = await scrapePage(url);
        // Truncate each scraped content to 1000 characters to reduce size
        scrapedArray.push(scrapedContent.substring(0, 1000));
      }
    } else {
      try {
        // Perform a Google search
        const searchURL = `https://www.google.com/search?q=${encodeURIComponent(
          question
        )}`;
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

          if (link && link.startsWith("/url?q=")) {
            const url = link.split("/url?q=")[1].split("&")[0];
            if (url) {
              results.push(url);
            }
          }

          if (results.length >= 5) return false;
        });

        for (const url of results) {
          const scrapedContent = await scrapePage(url);
          scrapedArray.push(scrapedContent.substring(0, 1000)); // Truncate to 1000 chars
        }
      } catch (error) {
        console.error(error);
      }
    }

    // Truncate conversation history to stay within token limits
    conversationHistory = truncateConversationHistory(
      conversationHistory,
      TOKEN_LIMIT - question.length - scrapedArray.join("\n\n").length
    );

    const prompt = `
        You are an AI assistant. You have been provided with the following data, scraped from various websites:

        ${scrapedArray.join("\n\n")}

        with URLs: ${urls || "None"}. Also you are an academic expert, you always cite your sources and base your response only on the
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

    // Append the new message and response to the conversation history
    conversationHistory.push({ role: "user", content: question });
    conversationHistory.push({ role: "assistant", content: llmOutput ?? "" });

    // Save updated conversation back to Redis
    await redis.set(conversationKey, JSON.stringify(conversationHistory), {
      ex: 86400, // Cache for 1 day
    });

    return new Response(JSON.stringify({ llmOutput }), { status: 200 });
  } catch (error) {
    console.error("Error in POST handler:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
