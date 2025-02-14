const express = require('express');
const path = require('path');
const router = express.Router();
const puppeteer = require('puppeteer');
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

let browserInstance;

// Reuse Puppeteer browser instance
async function getBrowserInstance() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browserInstance;
}

// Routes
router.get('/', (req, res) => {
    res.render('downloader');
});

router.post('/api/fetch-instagram-post', async (req, res) => {
    const { url } = req.body;

    if (!validator.isURL(url)) {
        return res.status(400).json({ success: false, message: 'Invalid URL' });
    }

    try {
        const [content, igResponse] = await Promise.all([
            fetchInstagramContent(url),
            instagramGetUrl(url)
        ]);

        const mediaType = await detectMediaType(igResponse?.url_list?.[0]);

        res.json({
            success: true,
            type: 'post',
            title: content.title,
            thumbnail: content.thumbnail,
            username: content.username,
            downloadUrl: igResponse?.url_list?.[0] || null,
            mediaType
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Download route
router.get('/download', async (req, res) => {
    const { url, filename } = req.query;

    if (!url || !filename || !validator.isURL(url)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid URL or filename' 
        });
    }

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 60000,
            headers: {

                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36'
            }
        });

        const contentType = response.headers['content-type'];
        const contentLength = response.headers['content-length'];

        const fileExt = getFileExtension(contentType);
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9]/g, '-') + fileExt;

        res.setHeader('Content-Disposition', `attachment; filename="savereelify.com - ${sanitizedFilename}"`);
        res.setHeader('Content-Type', contentType);
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        response.data.pipe(res);

        response.data.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    message: 'Error downloading file' 
                });
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to download file' 
        });
    }
});

// Helper functions
async function fetchInstagramContent(url) {
    const browser = await getBrowserInstance();
    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0...');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

        const content = await page.evaluate(() => {
            const thumbnail = document.querySelector('meta[property="og:image"]')?.content || null;
            const title = document.title?.slice(0, 50) || 'Instagram Content';
            const username = document.querySelector('meta[property="og:title"]')?.content || null;

            return { thumbnail, title, username };
        });

        return content;
    } catch (error) {
        throw new Error('Failed to fetch Instagram content');
    } finally {
        await page.close();
    }
}

async function detectMediaType(url) {
    if (!url) return null;

    if (url.includes('.mp4')) return 'video';
    if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png')) return 'image';

    try {
        const response = await axios({
            method: 'HEAD',
            url: url,
            timeout: 5000
        });

        const contentType = response.headers['content-type'];
        if (contentType.includes('video')) return 'video';
        if (contentType.includes('image')) return 'image';

        return 'image';
    } catch (error) {
        console.error('Error detecting media type:', error);
        return url.includes('video') ? 'video' : 'image';
    }
}

function getFileExtension(contentType) {
    const types = {
        'video/mp4': '.mp4',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png'
    };
    return types[contentType] || '.jpg';
}

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

module.exports = router;