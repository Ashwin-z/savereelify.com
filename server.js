// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const instagramGetUrl = require('instagram-url-direct');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
// Middleware setup
app.use(cors({ origin: 'https://savereelify.com' }));

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Security middleware
// app.use(helmet({
//     contentSecurityPolicy: {
//         directives: {
//             defaultSrc: ["'self'"],
//             scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com'],
//             imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
//             mediaSrc: ["'self'", 'https:', 'blob:'],
//             connectSrc: ["'self'", 'https://api.instagram.com']
//         }
//     }
// }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        message: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'views', 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.get('/reels-downloader', (req, res) => {
    res.render('reels-downloader');
})
app.get('/coming-soon', (req, res) => {
    res.render('Coming');
})
app.get('/privacy-policy', (req, res) => { 
    res.render('privacy-policy');
});
app.get('/terms', (req, res) => { 
    res.render('terms');
});
app.get('/contact', (req, res) => { 
    res.render('contact');
});
app.get('/faq', (req, res) => { 
    res.render('faq');
});
app.get('/about', (req, res) => { 
    res.render('about');
});



const mp3Routes = require('./mp3Routes');
app.use('/', mp3Routes);

const reelRoutes = require('./post');
app.use('/', reelRoutes);

const story = require('./story');
app.use('/', story);

// Cache setup
const cache = new Map();
const CACHE_DURATION = 600000; // 1 hour

// Browser Manager Class
class BrowserManager {
    constructor() {
        this.browser = null;
        this.pages = new Map();
        this.maxPages = 5;
    } 

    async initialize() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                // executablePath: '/path/to/Chrome',
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-audio-output',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-breakpad',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--disable-renderer-backgrounding',
                    '--enable-features=NetworkService,NetworkServiceInProcess',
                    '--mute-audio',
                    '--no-default-browser-check',
                    '--no-experiments',
                    '--no-pings'
                ],
                defaultViewport: { width: 1280, height: 720 }
            });
        }
    }

    async getPage() {
        await this.initialize();
        
        // Find available page
        for (const [id, page] of this.pages) {
            if (!page.inUse) {
                page.inUse = true;
                return { page: page.page, id };
            }
        }

        // Create new page if limit not reached
        if (this.pages.size < this.maxPages) {
            const page = await this.browser.newPage();
            await this.setupPage(page);
            const id = Date.now().toString();
            this.pages.set(id, { page, inUse: true });
            return { page, id };
        }

        throw new Error('No pages available');
    }

    async setupPage(page) {
        await Promise.all([
            page.setRequestInterception(true),
            page.setDefaultNavigationTimeout(15000),
            page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        ]);

        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'other'].includes(resourceType) ||
                req.url().includes('analytics') ||
                req.url().includes('logging')) {
                req.abort();
            } else {
                req.continue();
            }
        });
    }

    async releasePage(id) {
        const page = this.pages.get(id);
        if (page) {
            page.inUse = false;
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.pages.clear();
        }
    }
}

const browserManager = new BrowserManager();

// URL validation
function validateInstagramUrl(url) {
    const reelPattern = /^https:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|tv)\/([A-Za-z0-9_-]{11})\/?(?:\?.*)?$/;
    return reelPattern.test(url);
}

// Content fetching function
async function fetchReelContent(url, page) {
    try {
        await page.evaluate(() => {
            window.scrollBy = () => {};
            window.innerWidth = 1280;
            window.innerHeight = 720;
        });

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        const content = await page.evaluate(() => {
            const metaTags = {};
            document.querySelectorAll('meta[property^="og:"]').forEach(meta => {
                metaTags[meta.getAttribute('property')] = meta.getAttribute('content');
            });

            return {
                thumbnail: metaTags['og:image'] || null,
                title: document.title?.slice(0, 50) || 'Instagram Reel',
                username: metaTags['og:title'] || null
            };
        });

        return content;
    } catch (error) {
        console.error('Error in fetchReelContent:', error);
        throw error;
    }
}

// Routes
app.get('/', (req, res) => { 
    res.render('index');
});

app.get('/test', (req, res) => {
    res.json({ message: 'Server is working!' });
});

// Instagram API endpoint
app.post('/api/fetch-instagram', async (req, res) => {
    const { url } = req.body;
    
    if (!url || !validateInstagramUrl(url)) {
        return res.status(400).json({
            success: false,
            message: 'Please provide a valid Instagram reel URL'
        });
    }

    try {
        // Check cache
        const cachedData = cache.get(url);
        if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
            return res.json(cachedData.data);
        }

        const { page, id } = await browserManager.getPage();
        
        // Parallel fetching with timeout
        const [content, igResponse] = await Promise.all([
            fetchReelContent(url, page),
            Promise.race([
                instagramGetUrl(url),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 15000)
                )
            ])
        ]);

        await browserManager.releasePage(id);

        if (!igResponse?.url_list?.length) {
            throw new Error('Failed to fetch reel data');
        }

        const mediaUrl = igResponse.url_list.find(url => url.includes('.mp4'));
        const responseData = {
            success: true,
            type: 'reel',
            title: content.title,
            thumbnail: content.thumbnail,
            downloadUrl: mediaUrl,
            mediaType: 'video'
        };

        // Cache successful responses
        cache.set(url, {
            timestamp: Date.now(),
            data: responseData
        });

        res.json(responseData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reel: ' + error.message
        });
    }
});

// Download endpoint
app.get('/download', async (req, res) => {
    const { url, filename } = req.query;
    
    if (!url) {
        return res.status(400).json({ 
            success: false,
            message: 'Download URL is required' 
        });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            },
            timeout: 30000,
            maxContentLength: 200 * 1024 * 1024,
            signal: controller.signal,
            onDownloadProgress: (progressEvent) => {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                if (percentCompleted % 5 === 0) {
                    res.write(`data: ${JSON.stringify({ progress: percentCompleted })}\n\n`);
                }
            }
        });

        clearTimeout(timeout);

        const sanitizedFilename = encodeURIComponent(filename || 'instagram-reel.mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache');
        
        response.data.pipe(res);
        
        let error = null;
        response.data.on('error', (err) => {
            error = err;
            console.error('Stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'Download failed' });
            }
        });

        response.data.on('end', () => {
            if (error) {
                console.error('Download ended with error:', error);
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        if (error.response?.status === 404) {
            res.status(404).json({ 
                success: false,
                message: 'Content not found' 
            });
        } else if (error.code === 'ECONNABORTED') {
            res.status(408).json({
                success: false,
                message: 'Download timeout'
            });
        } else {
            res.status(500).json({ 
                success: false,
                message: 'Download failed',
                details: error.message 
            });
        }
    }
});

// Error handling middleware
const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    
    if (err.name === 'AbortError') {
        return res.status(408).json({
            success: false,
            message: 'Request timeout'
        });
    }
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }
    
    res.status(500).json({
        success: false,
        message: 'An unexpected error occurred'
    });
};

app.use(errorHandler);

// Cache cleanup interval
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            cache.delete(key);
        }
    }
}, CACHE_DURATION);

// Graceful shutdown handling
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Starting graceful shutdown...');
    await browserManager.cleanup();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log('SIGINT received. Starting graceful shutdown...');
    await browserManager.cleanup();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    browserManager.cleanup()
        .then(() => {
            process.exit(1);
        });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`Server is running on http://127.0.0.1:${PORT}`);
});