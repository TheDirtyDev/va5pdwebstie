const express = require('express');
const session = require('express-session');
const axios = require('axios');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mysql = require('mysql2');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- CONFIGURATION ---
const OWNER_ROLE_ID = "1449514984290783433"; 
const GUILD_ID = "1447360424487030816"; 

// --- DATABASE CONNECTION ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'fivem', // Updated database name
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- SESSION & PASSPORT SETUP ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'va5pd-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true, 
    cookie: {
        secure: true, 
        maxAge: 60000 * 60 * 24,
        sameSite: 'lax'
    }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: '1461768848620654743', 
    clientSecret: process.env.DISCORD_CLIENT_SECRET, 
    callbackURL: 'https://va5pd2026.vercel.app/auth/discord/callback',
    scope: ['identify', 'guilds', 'guilds.members.read']
}, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken; 
    return done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());


// --- ROUTES ---

app.get('/', (req, res) => {
    res.render('home', { user: req.user, owner: OWNER_ID });
});

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => res.redirect('/'));

app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

// --- SERVER STATUS ROUTE ---
app.get('/status', async (req, res) => {
    // Configuration
    const JOIN_CODE = "9pvveb";
    const HARDCODED_NAME = "Virginia FivePD | Active Staff/LEO | Apply now for a department!";
    
    // Default state if API is down or server is offline
    let serverData = { 
        online: false, 
        players: [], 
        maxPlayers: 64, // Default fallback
        name: HARDCODED_NAME, 
        joinUrl: `https://cfx.re/join/${JOIN_CODE}` 
    };

    try {
        // Fetching from FiveM Proxy API
        const response = await axios.get(`https://servers-frontend.fivem.net/api/servers/single/${JOIN_CODE}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 5000 // 5 second timeout to prevent Vercel hanging
        });

        if (response.data && response.data.Data) {
            const data = response.data.Data;
            
            serverData = {
                online: true,
                players: data.players || [],
                maxPlayers: data.sv_maxclients || 64,
                name: HARDCODED_NAME, // Overriding the messy API hostname
                joinUrl: `https://cfx.re/join/${JOIN_CODE}`
            };
        }
    } catch (error) {
        console.error("FiveM API Fetch Error:", error.message);
        // We keep serverData.online as false, but the name remains "Virginia FivePD"
        serverData.online = false;
    }

    // Render the status page with our user context and hard-coded server data
    res.render('status', { 
        user: req.user, 
        server: serverData 
    });
});

// STORE PAGE
app.get('/store', (req, res) => {
    db.query("SELECT * FROM store_items ORDER BY is_announcement DESC, createdAt DESC", (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Database Error: " + err.message);
        }
        res.render('store', { 
            user: req.user, 
            items: results || [], 
            owner: OWNER_ID,
            ticketUrl: "https://discord.gg/5xpZrjBNDq" 
        });
    });
});

// ADMIN PANEL
app.get('/admin', async (req, res) => {
    // 1. Security Check: Checks if user exists and has the required Role ID
    // Note: This assumes req.user.roles is an array of IDs from your Discord Strategy
    const hasAdminRole = req.user && req.user.roles && req.user.roles.includes(OWNER_ROLE_ID);

    if (!hasAdminRole) {
        return res.status(403).send(`
            <div style="background:#0b0f1a; color:#ef4444; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif;">
                <h1 style="font-weight:900; letter-spacing:-1px;">UNAUTHORIZED ACCESS</h1>
                <p style="color:#64748b;">Required Role: ${OWNER_ROLE_ID}</p>
                <a href="/" style="margin-top:20px; color:#fff; text-decoration:none; border:1px solid #333; padding:10px 20px; border-radius:8px;">Return to Home</a>
            </div>
        `);
    }

    try {
        // 2. Fetch Data using Promises for stability
        const promiseDb = db.promise();

        // Run counts for Updates and Store Items
        const [updateCount] = await promiseDb.query("SELECT COUNT(*) as count FROM updates");
        const [itemCount] = await promiseDb.query("SELECT COUNT(*) as count FROM store_items");

        // 3. Render the Admin Dashboard
        res.render('admin_panel', { 
            user: req.user,
            adminPanelData: {
                stats: {
                    updates: updateCount[0].count,
                    items: itemCount[0].count,
                    activeUsers: 0 // You can replace this with a real query if needed later
                },
                users: []
            }
        });

    } catch (err) {
        console.error("Admin Route Error:", err);
        res.status(500).send(`
            <div style="background:#111; color:#ff4444; padding:20px; font-family:monospace;">
                <h1>Admin Panel Terminal Error</h1>
                <p>${err.message}</p>
                <a href="/" style="color:#fff;">Back Home</a>
            </div>
        `);
    }
});

// UPDATES PAGE
app.get('/updates', (req, res) => {
    db.query("SELECT * FROM updates ORDER BY createdAt DESC", (err, results) => {
        if (err) return res.status(500).send(err.message);
        res.render('updates', { user: req.user, updates: results, owner: OWNER_ID });
    });
});

// --- UPDATES LOGIC ---

app.post('/updates/post', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    const { title, message, contributors, img1, img2, img3 } = req.body;
    const query = "INSERT INTO updates (title, message, contributors, img1, img2, img3) VALUES (?, ?, ?, ?, ?, ?)";
    
    try {
        await db.promise().query(query, [title, message, contributors, img1, img2, img3]);
        res.redirect('/updates');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error posting update: " + err.message);
    }
});

app.get('/updates/delete/:id', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    try {
        await db.promise().query("DELETE FROM updates WHERE id = ?", [req.params.id]);
        res.redirect('/updates');
    } catch (err) {
        res.status(500).send("Error deleting update.");
    }
});

// --- STORE LOGIC ---

app.post('/store/add', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    const { title, description, price, sale_price, image, category, is_announcement } = req.body;
    // Checkboxes only send a value if checked; we convert it to 1 or 0 for MySQL
    const announcement = (is_announcement === '1' || is_announcement === 'on') ? 1 : 0;
    
    const query = "INSERT INTO store_items (title, description, price, sale_price, image, category, is_announcement) VALUES (?, ?, ?, ?, ?, ?, ?)";
    
    try {
        await db.promise().query(query, [
            title, 
            description, 
            price, 
            sale_price || null, 
            image || null, 
            category, 
            announcement
        ]);
        res.redirect('/store');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding product.");
    }
});

app.post('/store/edit/:id', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    const { title, description, price, sale_price, image, category } = req.body;
    const query = "UPDATE store_items SET title=?, description=?, price=?, sale_price=?, image=?, category=? WHERE id=?";
    
    try {
        await db.promise().query(query, [
            title, 
            description, 
            price, 
            sale_price || null, 
            image || null, 
            category, 
            req.params.id
        ]);
        res.redirect('/store');
    } catch (err) {
        res.status(500).send("Error editing product.");
    }
});

app.get('/store/delete/:id', async (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    
    try {
        await db.promise().query("DELETE FROM store_items WHERE id = ?", [req.params.id]);
        res.redirect('/store');
    } catch (err) {
        res.status(500).send("Error deleting product.");
    }
});
// --- ADMIN LOGIC ---
app.post('/store/add', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    const { title, description, price, sale_price, image, category, is_announcement } = req.body;
    const announcement = is_announcement ? 1 : 0;
    db.query("INSERT INTO store_items (title, description, price, sale_price, image, category, is_announcement) VALUES (?, ?, ?, ?, ?, ?, ?)", 
    [title, description, price, sale_price || null, image, category, announcement], (err) => {
        if (err) return res.status(500).send(err.message);
        res.redirect('/store');
    });
});

app.get('/store/delete/:id', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    db.query("DELETE FROM store_items WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err.message);
        res.redirect('/store');
    });
});

// EMAIL FUNCTION
app.post('/tools/email-receipt', async (req, res) => {
    // Destructure data from request body
    const { email, handler, card, taxRate, signature, items, subtotal, taxAmount, grandTotal } = req.body;

    // 1. Validation check - prevents server crash if data is missing
    if (!email || !items) {
        return res.status(400).send("Missing required receipt data.");
    }

    // 2. Configuration for Gmail (Optimized for Vercel/Serverless)
    let transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // use SSL
        auth: {
            user: process.env.EMAIL_USER, 
            pass: process.env.EMAIL_PASS  
        }
    });

    // Build the table rows for the HTML email
    const itemRows = items.map(item => `
        <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px; font-family: sans-serif; font-size: 14px; color: #333;">${item.desc}</td>
            <td style="padding: 10px; font-family: sans-serif; font-size: 14px; text-align: right; font-weight: bold; color: #333;">$${item.price}</td>
        </tr>
    `).join('');

    const htmlBody = `
    <div style="background-color: #f8fafc; padding: 40px; font-family: sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
            <div style="background-color: #0b0f1a; padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">VA5PD NETWORK</h1>
                <p style="color: #64748b; margin: 5px 0 0; font-size: 12px; text-transform: uppercase;">Transaction Receipt</p>
            </div>
            <div style="padding: 30px;">
                <table width="100%" style="margin-bottom: 20px;">
                    <tr>
                        <td style="font-size: 12px; color: #64748b;"><strong>BILLED TO:</strong><br>${email}</td>
                        <td style="font-size: 12px; color: #64748b; text-align: right;"><strong>DATE:</strong><br>${new Date().toLocaleDateString()}</td>
                    </tr>
                </table>
                
                <table width="100%" style="border-collapse: collapse; margin-bottom: 20px;">
                    <thead>
                        <tr style="background-color: #f1f5f9;">
                            <th style="text-align: left; padding: 10px; font-size: 12px; color: #475569;">Item Description</th>
                            <th style="text-align: right; padding: 10px; font-size: 12px; color: #475569;">Price</th>
                        </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                </table>

                <div style="text-align: right; border-top: 2px solid #f1f5f9; padding-top: 15px;">
                    <p style="margin: 5px 0; font-size: 14px; color: #475569;">Subtotal: <strong>$${subtotal}</strong></p>
                    <p style="margin: 5px 0; font-size: 14px; color: #475569;">Tax (${taxRate}%): <strong>$${taxAmount}</strong></p>
                    <p style="margin: 10px 0; font-size: 20px; color: #ef4444;"><strong>Total: $${grandTotal}</strong></p>
                </div>

                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px dashed #e2e8f0;">
                    <p style="font-size: 10px; color: #94a3b8; margin-bottom: 5px; text-transform: uppercase;">Authorized Handler: ${handler}</p>
                    <p style="font-size: 10px; color: #94a3b8; margin-bottom: 5px; text-transform: uppercase;">Payment Method: ${card}</p>
                    <p style="font-family: 'Georgia', serif; font-size: 26px; color: #ef4444; margin: 10px 0; font-style: italic;">${signature}</p>
                </div>
            </div>
            <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                Thank you for choosing VA5PD. This is an automated receipt generated by the Owner Command Center.
            </div>
        </div>
    </div>`;

    try {
        await transporter.sendMail({
            from: '"VA5PD Network" <virginia5pd.support@gmail.com>',
            to: email,
            subject: 'Your Official VA5PD Receipt',
            html: htmlBody 
        });
        res.status(200).send('OK');
    } catch (err) {
        console.error("Nodemailer Error:", err.message);
        // On Vercel, this error message will appear in your Dashboard Logs
        res.status(500).json({ error: err.message });
    }
});
// --- VERCEL EXPORT ---
if (process.env.NODE_ENV !== 'production') {
    app.listen(4000, () => console.log('Running on http://localhost:4000'));
}

module.exports = app;
