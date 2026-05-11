const express = require('express');
const session = require('express-session');
const axios = require('axios');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mysql = require('mysql2');
const path = require('path');
const app = express();

// --- CONFIGURATION ---
const OWNER_ID = "895054825316839424"; // J. COX DISCORD ID
const GUILD_ID = "1447360424487030816"; // VA5PD MAIN DISCORD
const LEO_ROLE_ID = "1465133005977944237"; // PUBLIC LAW


// --- DATABASE CONNECTION ---
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'fivem_reports',
    port: process.env.DB_PORT || 4000,
    multipleStatements: true,
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

// --- SESSION & PASSPORT SETUP ---
app.use(session({ 
    secret: 'va5pd-secret-key', 
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 60000 * 60 * 24 } // 24 Hours
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: '1461768848620654743', 
    // This pulls the secret from Vercel's secure settings instead of hardcoding it
    clientSecret: process.env.DISCORD_CLIENT_SECRET, 
    callbackURL: 'https://va5pd2026.vercel.app/auth/discord/callback',
    scope: ['identify', 'guilds', 'guilds.members.read']
}, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken; 
    return done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());

// --- LEO PERMISSION CHECKER ---
async function getDiscordMember(user) {
    // If the session didn't save the token, this will fail
    const token = user.accessToken || (user.auth && user.auth.accessToken);
    
    if (!token) {
        console.log("DEBUG: Access Token is MISSING from the user object.");
        return null;
    }

    try {
        const response = await axios.get(
            `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
            { 
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                } 
            }
        );
        return response.data;
    } catch (error) {
        console.log("--- TERMINAL ERROR LOG ---");
        console.log("Status:", error.response?.status);
        console.log("Message:", error.response?.data?.message);
        console.log("Token being sent:", token.substring(0, 5) + "..."); // Just shows start of token
        return null;
    }
}

// --- DEBUGGING ROUTE TO CHECK ROLES ---
app.get('/debug-roles', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');
    
    const member = await getDiscordMember(req.user);
    
    if (member) {
        console.log("================================");
        console.log("DEBUG FOR USER:", member.user.username);
        console.log("YOUR ACTUAL ROLES IN SERVER:");
        console.log(member.roles); // This prints the array of IDs you actually have
        console.log("SEARCHING FOR LEO_ROLE_ID:", LEO_ROLE_ID);
        console.log("================================");
        
        return res.send(`Check your terminal! Found ${member.roles.length} roles for you.`);
    }
    
    res.send("Could not find you in the server. Is the Bot in the server?");
});

// --- AUTH ROUTES ---
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => res.redirect('/'));

app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

// --- PAGE ROUTES ---

app.get('/', (req, res) => {
    res.render('home', { user: req.user, owner: OWNER_ID });
});

// LEO DASHBOARD
app.get('/leo', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');

    const member = await getDiscordMember(req.user);
    
    if (member && member.roles.includes(LEO_ROLE_ID)) {
        res.render('leo', { 
            user: req.user, 
            member: member, 
            owner: OWNER_ID 
        });
    } else {
        res.status(403).send(`
            <div style="background:#000;color:#f00;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;text-align:center;">
                <h1>ACCESS DENIED</h1>
                <p>You do NOT have the required ROLES for this page.</p>
                <p style="color:#666;font-size:12px;">If you recently got the role, please log out and back in.</p>
                <a href="/" style="color:#fff;border:1px solid #fff;padding:10px 20px;text-decoration:none;margin-top:20px;">Return Home</a>
            </div>
        `);
    }
});

// ADMIN PANEL
app.get('/admin', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");

    const queries = [
        "SELECT COUNT(*) as count FROM updates",
        "SELECT COUNT(*) as count FROM store_items",
        "SELECT * FROM reports ORDER BY created_at DESC LIMIT 5",
        "SELECT COUNT(*) as count FROM reports WHERE status = 'Pending'"
    ].join('; ');

    db.query(queries, (err, results) => {
        if (err) return res.status(500).send("Database Error");
        res.render('admin_panel', {
            user: req.user,
            owner: OWNER_ID,
            adminPanelData: {
                stats: {
                    updates: results[0][0].count,
                    items: results[1][0].count,
                    activeUsers: 0, 
                    pendingReports: results[3][0].count
                },
                users: [], 
                recentReports: results[2]
            }
        });
    });
});

app.get('/status', async (req, res) => {
    const JOIN_CODE = "9pvveb";
    let serverData = { online: false, players: [], maxPlayers: 0, name: "DD-RP Server", joinUrl: `https://cfx.re/join/${JOIN_CODE}` };
    try {
        const response = await axios.get(`https://servers-frontend.fivem.net/api/servers/single/${JOIN_CODE}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (response.data?.Data) {
            const data = response.data.Data;
            serverData = {
                online: true,
                players: data.players,
                maxPlayers: data.sv_maxclients,
                name: data.hostname.replace(/\^[0-9]/g, ""),
                joinUrl: `https://cfx.re/join/${JOIN_CODE}`
            };
        }
    } catch (e) { serverData.online = false; }
    res.render('status', { user: req.user, server: serverData });
});

app.get('/updates', (req, res) => {
    db.query("SELECT * FROM updates ORDER BY createdAt DESC", (err, results) => {
        if (err) throw err;
        res.render('updates', { user: req.user, updates: results, owner: OWNER_ID });
    });
});

app.get('/store', (req, res) => {
    db.query("SELECT * FROM store_items ORDER BY is_announcement DESC, createdAt DESC", (err, results) => {
        if (err) throw err;
        res.render('store', { 
            user: req.user, items: results, owner: OWNER_ID,
            ticketUrl: "https://discord.gg/5xpZrjBNDq" 
        });
    });
});

app.get('/server', (req, res) => res.render('server', { user: req.user }));

// --- LOGIC ROUTES ---

app.post('/updates/post', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    const { title, message, contributors, img1, img2, img3 } = req.body;
    db.query("INSERT INTO updates (title, message, contributors, img1, img2, img3) VALUES (?, ?, ?, ?, ?, ?)", [title, message, contributors, img1, img2, img3], (err) => {
        if (err) throw err;
        res.redirect('/updates');
    });
});

app.get('/updates/delete/:id', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    db.query("DELETE FROM updates WHERE id = ?", [req.params.id], (err) => {
        if (err) throw err;
        res.redirect('/updates');
    });
});

app.post('/store/add', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    const { title, description, price, sale_price, image, category, is_announcement } = req.body;
    const announcement = is_announcement ? 1 : 0;
    db.query("INSERT INTO store_items (title, description, price, sale_price, image, category, is_announcement) VALUES (?, ?, ?, ?, ?, ?, ?)", [title, description, price, sale_price || null, image, category, announcement], (err) => {
        if (err) throw err;
        res.redirect('/store');
    });
});

app.post('/store/edit/:id', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    const { title, description, price, sale_price, image, category } = req.body;
    db.query("UPDATE store_items SET title=?, description=?, price=?, sale_price=?, image=?, category=? WHERE id=?", [title, description, price, sale_price || null, image, category, req.params.id], (err) => {
        if (err) throw err;
        res.redirect('/store');
    });
});

app.get('/store/delete/:id', (req, res) => {
    if (!req.user || req.user.id !== OWNER_ID) return res.status(403).send("Unauthorized");
    db.query("DELETE FROM store_items WHERE id = ?", [req.params.id], (err) => {
        if (err) throw err;
        res.redirect('/store');
    });
});

app.post('/leo/submit-form', (req, res) => {
    if (!req.user) return res.status(403).send("Unauthorized");

    const { formType, subject_name, narrative } = req.body;
    const officer = req.user.username;

    const query = "INSERT INTO submissions (officer_name, form_type, subject_name, narrative) VALUES (?, ?, ?, ?)";
    db.query(query, [officer, formType, subject_name, narrative], (err) => {
        if (err) throw err;
        res.redirect('/leo'); // Takes them back to the dash
    });
});

app.listen(4000, () => {
    console.log('====================================');
    console.log('Web running on http://localhost:4000');
    console.log('Connected to Database');
    console.log('====================================');
});
