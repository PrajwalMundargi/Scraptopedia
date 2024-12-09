import puppeteer from 'puppeteer';
import fs from 'fs';
import readline from 'readline';

// Configuration
const DEFAULT_LIMIT = 100;
const WEBSITE_TYPES = {
    NEWS: 'news',
    ECOMMERCE: 'ecommerce',
    WEATHER: 'weather' // Added weather website type
};

// Function to extract date (unchanged from original)
async function extractDate(page) {
    const date = await page.evaluate(() => {
        const dateSelectors = [
            'meta[property="article:published_time"]',
            'meta[name="publication-date"]',
            'time',
            '.date',
            '[datetime]'
        ];

        for (const selector of dateSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                return element.getAttribute('content') || 
                       element.getAttribute('datetime') || 
                       element.textContent;
            }
        }
        return new Date().toISOString();
    });
    
    return date;
}

// Function to extract weather data
async function extractWeatherData(page) {
    const data = await page.evaluate(() => {
        const weatherData = {};

        // Common selectors for weather data
        const selectors = {
            temperature: '.temperature, .temp, [data-temp]',
            condition: '.condition, .weather-condition, [data-condition]',
            location: '.location, .city-name, [data-location]',
            humidity: '.humidity, .humidity-level, [data-humidity]',
            wind: '.wind, .wind-speed, [data-wind]'
        };

        // Helper to extract text from a selector
        const extractText = (selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent.trim() : null;
        };

        weatherData.temperature = extractText(selectors.temperature);
        weatherData.condition = extractText(selectors.condition);
        weatherData.location = extractText(selectors.location);
        weatherData.humidity = extractText(selectors.humidity);
        weatherData.wind = extractText(selectors.wind);
        
        weatherData.source = window.location.hostname;
        weatherData.url = window.location.href;
        return weatherData;
    });

    return data;
}

// Function to extract product data for e-commerce sites
async function extractProductData(page) {
    const data = await page.evaluate(() => {
        // Helper function to get meta content
        const getMeta = (name) => {
            const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"], meta[property="og:${name}"]`);
            return element ? element.getAttribute('content') : null;
        };

        // Helper function to extract price
        const getPrice = () => {
            const priceSelectors = [
                '[data-price]',
                '.price',
                '.product-price',
                '[itemprop="price"]',
                '.sale-price'
            ];

            for (const selector of priceSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const price = element.getAttribute('data-price') || 
                                element.getAttribute('content') || 
                                element.textContent;
                    return price.replace(/[^0-9.]/g, '');
                }
            }
            return null;
        };

        // Helper function to get product images
        const getProductImages = () => {
            const images = [];
            const imageElements = document.querySelectorAll('.product-image img, .gallery img, [data-image]');
            imageElements.forEach(img => {
                const src = img.getAttribute('data-src') || img.getAttribute('src');
                if (src) images.push(src);
            });
            return images.length > 0 ? images : [getMeta('og:image')];
        };

        // Helper function to get product variants
        const getVariants = () => {
            const variants = [];
            const variantElements = document.querySelectorAll('[data-variant], .variant-option, .product-variant');
            variantElements.forEach(element => {
                variants.push({
                    name: element.getAttribute('data-variant-name') || element.textContent,
                    value: element.getAttribute('data-variant-value'),
                    price: element.getAttribute('data-variant-price')
                });
            });
            return variants;
        };

        return {
            title: getMeta('title') || document.title,
            description: getMeta('description') || document.querySelector('.product-description')?.textContent,
            url: window.location.href,
            store: window.location.hostname,
            price: getPrice(),
            currency: document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || 'USD',
            images: getProductImages(),
            brand: getMeta('brand') || document.querySelector('[itemprop="brand"]')?.textContent,
            sku: document.querySelector('[itemprop="sku"]')?.textContent,
            availability: document.querySelector('[itemprop="availability"]')?.getAttribute('content') || 'in stock',
            variants: getVariants(),
            category: document.querySelector('[itemprop="category"]')?.textContent || 
                     document.querySelector('.breadcrumb')?.textContent,
            rating: document.querySelector('[itemprop="ratingValue"]')?.textContent,
            reviewCount: document.querySelector('[itemprop="reviewCount"]')?.textContent
        };
    });

    return data;
}

// Original news article extraction function (unchanged)
async function extractArticleData(page) {
    const data = await page.evaluate(() => {
        const getMeta = (name) => {
            const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"], meta[property="og:${name}"]`);
            return element ? element.getAttribute('content') : null;
        };

        const getMainImage = () => {
            const ogImage = getMeta('og:image');
            if (ogImage) return ogImage;

            const firstImage = document.querySelector('article img, .main-content img');
            return firstImage ? firstImage.src : null;
        };

        const getAuthor = () => {
            const authorSelectors = [
                'meta[name="author"]',
                '.author',
                '.byline',
                '[rel="author"]'
            ];

            for (const selector of authorSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    return element.getAttribute('content') || element.textContent.trim();
                }
            }
            return 'Unknown Author';
        };

        return {
            title: getMeta('title') || document.title,
            description: getMeta('description') || document.querySelector('p')?.textContent?.slice(0, 200),
            url: window.location.href,
            source: window.location.hostname,
            image: getMainImage(),
            author: getAuthor(),
            category: getMeta('category') || 'general',
            language: document.documentElement.lang || 'en',
            country: 'us'
        };
    });

    data.published_at = await extractDate(page);
    return data;
}

// Function to get relevant links based on website type
async function getRelevantLinks(page, websiteType) {
    return await page.evaluate((type) => {
        let links;
        if (type === 'news') {
            links = Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => 
                    href.includes('/article/') || 
                    href.includes('/story/') || 
                    href.includes('/news/') ||
                    href.match(/\d{4}\/\d{2}\/\d{2}/)
                );
        } else if (type === 'ecommerce') {
            links = Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => 
                    href.includes('/product/') || 
                    href.includes('/item/') || 
                    href.includes('/p/') ||
                    href.match(/product-detail/) ||
                    href.match(/\/dp\/[A-Z0-9]+/)
                );
        } else if (type === 'weather') {
            links = Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => 
                    href.includes('/weather/') ||
                    href.includes('/forecast/') ||
                    href.match(/current-weather/)
                );
        }
        return [...new Set(links)]; // Remove duplicates
    }, websiteType);
}

// Enhanced main scraping function
async function scrapePage(url, websiteType, timeLimit, limit = DEFAULT_LIMIT, offset = 0) {
    const browser = await puppeteer.launch({ headless: "new" });
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
                const itemData = websiteType === WEBSITE_TYPES.NEWS ? 
                    await extractArticleData(page) : 
                    websiteType === WEBSITE_TYPES.ECOMMERCE ? 
                    await extractProductData(page) : 
                    await extractWeatherData(page); // Handle weather scraping
                items.push(itemData);
            } catch (error) {
                console.error(`Error scraping ${websiteType} page ${link}:`, error.message);
            }
        }

        // Create the final structured output
        const output = {
            websiteType,
            pagination: {
                limit,
                offset,
                count: items.length,
                total
            },
            data: items
        };

        // Save to file
        const fileName = `scraped_${websiteType}_${offset}_${limit}.json`;
        fs.writeFileSync(fileName, JSON.stringify(output, null, 2));
        console.log(`Data saved to ${fileName}`);

        return output;

    } catch (error) {
        console.error('Error during scraping:', error.message);
    } finally {
        await browser.close();
    }
}

// Enhanced user input function
async function getUserInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const websiteType = await new Promise(resolve => {
        rl.question(`Enter website type (${WEBSITE_TYPES.NEWS}, ${WEBSITE_TYPES.ECOMMERCE}, or ${WEBSITE_TYPES.WEATHER}): `, resolve);
    });

    if (!Object.values(WEBSITE_TYPES).includes(websiteType.toLowerCase())) {
        throw new Error('Invalid website type');
    }

    const url = await new Promise(resolve => {
        rl.question('Enter URL to scrape: ', resolve);
    });

    const timeLimit = await new Promise(resolve => {
        rl.question('Enter time limit in seconds: ', resolve);
    });

    const limit = await new Promise(resolve => {
        rl.question(`Enter limit (default ${DEFAULT_LIMIT}): `, resolve);
    });

    const offset = await new Promise(resolve => {
        rl.question('Enter offset (default 0): ', resolve);
    });

    rl.close();
    return { 
        url, 
        websiteType: websiteType.toLowerCase(),
        timeLimit: parseInt(timeLimit),
        limit: parseInt(limit) || DEFAULT_LIMIT,
        offset: parseInt(offset) || 0
    };
}

// Enhanced main function
async function main() {
    try {
        const { url, websiteType, timeLimit, limit, offset } = await getUserInput();

        if (!url || isNaN(timeLimit) || timeLimit <= 0) {
            console.error('Please provide a valid URL and time limit');
            return;
        }

        await scrapePage(url, websiteType, timeLimit, limit, offset);
        console.log('Scraping completed');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
