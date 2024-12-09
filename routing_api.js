import express from 'express';
import puppeteer from 'puppeteer';
import fs from 'fs';

// Configuration
const DEFAULT_LIMIT = 100;
const WEBSITE_TYPES = {
    NEWS: 'news',
    ECOMMERCE: 'ecommerce',
    WEATHER: 'weather'
};

const app = express();
app.use(express.json());
const PORT = 3000;

// Function to scrape a page (your existing scrapePage function)
async function scrapePage(url, websiteType, timeLimit, limit = DEFAULT_LIMIT, offset = 0) {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    try {
        console.log(`Scraping ${websiteType} website: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeLimit * 1000 });

        // Get relevant links based on website type
        const uniqueLinks = await getRelevantLinks(page, websiteType);

        // Calculate pagination
        const total = uniqueLinks.length;
        const paginatedLinks = uniqueLinks.slice(offset, offset + limit);

        // Scrape each page
        const items = [];
        for (const link of paginatedLinks) {
            try {
                await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const itemData =
                    websiteType === WEBSITE_TYPES.NEWS
                        ? await extractArticleData(page)
                        : websiteType === WEBSITE_TYPES.ECOMMERCE
                        ? await extractProductData(page)
                        : await extractWeatherData(page); // Handle weather scraping
                items.push(itemData);
            } catch (error) {
                console.error(`Error scraping ${websiteType} page ${link}:`, error.message);
            }
        }

        // Create the final structured output
        return {
            websiteType,
            pagination: {
                limit,
                offset,
                count: items.length,
                total,
            },
            data: items,
        };
    } catch (error) {
        console.error('Error during scraping:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Express route for the scraping API
app.post('/scrape', async (req, res) => {
    const { url, websiteType, timeLimit, limit = DEFAULT_LIMIT, offset = 0 } = req.body;

    if (!url || !websiteType || !timeLimit) {
        return res.status(400).json({ error: 'url, websiteType, and timeLimit are required fields.' });
    }

    if (!Object.values(WEBSITE_TYPES).includes(websiteType.toLowerCase())) {
        return res.status(400).json({ error: `Invalid websiteType. Supported types: ${Object.values(WEBSITE_TYPES).join(', ')}` });
    }

    try {
        const data = await scrapePage(url, websiteType.toLowerCase(), parseInt(timeLimit), parseInt(limit), parseInt(offset));
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'An error occurred during scraping.', details: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Scraper API running at http://localhost:${PORT}`);
});
