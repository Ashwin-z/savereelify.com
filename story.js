const express = require('express');
const path = require('path');
const router = express.Router();
// const puppeteer = require('puppeteer');
const instagramGetUrl = require('instagram-url-direct');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const app = express();
app.set('trust proxy', 1);
// Middleware
app.use(cors());
app.use(helmet());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Static files
app.use(express.static(path.join(__dirname, 'views', 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));


router.get('/insta-story', (req, res) => {
    res.render('Coming');
});


const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

require('dotenv').config();

puppeteer.use(StealthPlugin());

 
app.post('/fetch-stories', async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) return res.status(400).json({ success: false, error: 'Missing input' });
        
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Improved login handling
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2' });
        await page.type('input[name="username"]', process.env.IG_USERNAME);
        await page.type('input[name="password"]', process.env.IG_PASSWORD);
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' })
        ]);
        // Go to target profile
        await page.goto(`https://www.instagram.com/${username}/`);
        
        // Check for stories availability
        const storiesAvailable = await page.evaluate(() => {
            const storyElement = document.querySelector('div[role="button"] > div > div');
            return storyElement && window.getComputedStyle(storyElement).backgroundImage !== 'none';
        });

        if (!storiesAvailable) {
            await browser.close();
            return res.json({ success: true, stories: [] });
        }

        await page.goto(`https://www.instagram.com/${username}/`, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        const hasStories = await page.evaluate(() => {
            return !!document.querySelector('div[aria-label="Story"]');
        });        
        const stories = await page.evaluate(() => {
            const items = [];
            const storyElements = document.querySelectorAll('main section div[role="button"]');
            
            storyElements.forEach(element => {
                const video = element.querySelector('video');
                const image = element.querySelector('img');
                if (video) items.push({ type: 'video', url: video.src });
                else if (image) items.push({ type: 'image', url: image.src });
            });

            return items;
        });

        await browser.close();
        res.json({ success: true, stories });
    } catch (error) {
        await browser.close();
        res.status(500).json({ 
            success: false, 
            error: error.message.includes('timeout') ? 'Request timeout' : 'Error fetching stories'
        });
    }
});

function extractUsername(input) {
    const urlRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^\/]+)/;
    const match = input.match(urlRegex);
    return match ? match[1] : input;
}


module.exports = router;