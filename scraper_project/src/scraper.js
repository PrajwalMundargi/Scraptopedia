import puppeteer from 'puppeteer';
import { rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import fs from 'fs';
import readline from 'readline';

// Clears temporary files created by Puppeteer
async function clearChromeTemp() {
    try {
        const tmpDir = join(tmpdir(), 'puppeteer_dev_chrome_profile-*');
        await rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
        // Ignore errors if directory doesn't exist
    }
}

// Scrapes a page and extracts links, images, and text
async function scrapePageData(page, url) {
    console.log(`Scraping: ${url}`);
    
    await page.goto(url, {
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: 60000  // Timeout after 60 seconds
    });

    await page.waitForSelector('body', { timeout: 60000 });

    const data = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')).map(a => a.href).filter(href => href);
        const images = Array.from(document.querySelectorAll('img')).map(img => img.src).filter(src => src);
        const textContent = document.body.innerText;

        return { links, images, textContent, htmlContent: document.documentElement.outerHTML };
    });

    return data;
}

// Crawls the website and scrapes data from multiple pages
async function crawlSite(url, browser, timeLimit) {
    const page = await browser.newPage();
    const visited = new Set();
    const allData = [];
    let startTime = Date.now(); // Track start time

    async function crawl(url) {
        if (visited.has(url)) return;  // Skip already visited pages

        const elapsedTime = (Date.now() - startTime) / 1000;
        if (elapsedTime >= timeLimit) { // Stop if time limit is reached
            console.log(`Time limit of ${timeLimit} seconds reached. Stopping scrape.`);
            return;
        }

        visited.add(url);
        const pageData = await scrapePageData(page, url);
        allData.push({ url, ...pageData });

        for (const link of pageData.links) {
            const elapsedTime = (Date.now() - startTime) / 1000;
            if (elapsedTime >= timeLimit) {
                console.log(`Time limit reached. Stopping scrape.`);
                return;
            }
            if (link.startsWith(url)) {  // Follow internal links only
                await crawl(link);
            }
        }
    }

    await crawl(url);
    await page.close();
    return allData;
}

// Filter out unwanted data and remove duplicates
function filterData(data) {
    const filteredData = {
        links: [],
        images: [],
        textContent: data.textContent,
        htmlContent: data.htmlContent
    };

    // Remove duplicate links and images
    const uniqueLinks = new Set(data.links);
    const uniqueImages = new Set(data.images);

    filteredData.links = Array.from(uniqueLinks);
    filteredData.images = Array.from(uniqueImages);

    // Filter out any empty or irrelevant content (adjust this logic as needed)
    filteredData.textContent = filteredData.textContent.replace(/\s+/g, ' ').trim();  // Clean up excessive whitespace

    return filteredData;
}

// Main scraping function that handles the puppeteer browser instance
async function scrapperFunc(url, timeLimit) {
    let browser = null;
    try {
        await clearChromeTemp();

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ],
            userDataDir: './chrome-data'  // Use a local directory for session storage
        });

        const data = await crawlSite(url, browser, timeLimit);
        return data;
    } catch (error) {
        console.error("Error while scraping:", error);
        throw error;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error("Error closing browser:", e);
            }
        }
        await clearChromeTemp();
    }
}

// Prompt for URL and time limit
async function promptForInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('Please enter the URL to scrape: ', (url) => {
            rl.question('Please enter the time limit in seconds: ', (timeLimit) => {
                rl.close();
                resolve({ url, timeLimit: parseInt(timeLimit, 10) });
            });
        });
    });
}

// Main function to execute the scraping and save data
async function main() {
    const { url, timeLimit } = await promptForInput();  // Prompt for URL and time limit

    if (!url) {
        console.error("You must provide a URL.");
        process.exit(1);
    }
    if (isNaN(timeLimit) || timeLimit <= 0) {
        console.error("Invalid time limit provided. Please enter a positive number.");
        process.exit(1);
    }

    try {
        console.log(`Starting to scrape: ${url} with a time limit of ${timeLimit} seconds`);
        const data = await scrapperFunc(url, timeLimit);

        // Save the original scraped data as a JSON file
        const fileName = url.replace(/^https?:\/\//, '').replace(/\//g, '_') + '.json';  // Clean URL to create file name
        fs.writeFileSync(fileName, JSON.stringify(data, null, 2));  // Save original data

        console.log(`Scraping completed successfully! Data saved as ${fileName}`);

        // Filter the scraped data and save it separately
        const filteredData = filterData(data[0]);  // Assuming data is an array of page data
        const filteredFileName = 'filtered_' + fileName;
        fs.writeFileSync(filteredFileName, JSON.stringify(filteredData, null, 2));  // Save filtered data

        console.log(`Filtered data saved as ${filteredFileName}`);
    } catch (error) {
        console.error("Error in scraping:", error);
    } finally {
        console.log("Script finished executing");
    }
}

main();
