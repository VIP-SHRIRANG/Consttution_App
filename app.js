const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dbConnection = require('./mongodb');
require('dotenv').config();

const app = express();

// ─────────────────────────────────────────────
// 🔑 PASTE YOUR KEYS HERE
// ─────────────────────────────────────────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const GOOGLE_CX      = process.env.GOOGLE_CX;

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// ─────────────────────────────────────────────
// Helper: Load JSON data files
// ─────────────────────────────────────────────
function loadJSON(filename) {
  const filePath = path.join(__dirname, 'data', filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[JSON LOAD ERROR] ${filename}:`, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// Helper: Smart fuzzy keyword search
// ─────────────────────────────────────────────
function smartSearch(data, query) {
  if (!query || query.trim() === '') return [];

  const terms = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1);

  return data.filter(item => {
    const haystack = [
      item.keyword || '',
      item.title || '',
      item.summary || '',
      item.full_description || '',
      item.description || '',
      ...(item.aliases || []),
      ...(item.law || []).map(l => l.article_title || ''),
    ]
      .join(' ')
      .toLowerCase();

    const matchCount = terms.filter(term => haystack.includes(term)).length;
    item._score = matchCount;
    return matchCount > 0;
  }).sort((a, b) => b._score - a._score);
}

// ─────────────────────────────────────────────
// Helper: Smart chatbot search
// ─────────────────────────────────────────────
function findChatbotResponse(responses, userInput) {
  const input = userInput.toLowerCase().trim();

  for (const entry of responses) {
    if (input === entry.question.toLowerCase()) return entry.response;
  }
  for (const entry of responses) {
    if (input.includes(entry.question.toLowerCase())) return entry.response;
  }
  for (const entry of responses) {
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        if (input.includes(alias.toLowerCase())) return entry.response;
      }
    }
  }

  const inputTokens = input.split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of responses) {
    const entryWords = [
      ...entry.question.toLowerCase().split(/\s+/),
      ...(entry.aliases || []).flatMap(a => a.toLowerCase().split(/\s+/)),
    ];
    const score = inputTokens.filter(t => entryWords.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry.response;
    }
  }

  if (bestScore >= 1) return bestMatch;
  return null;
}

// ─────────────────────────────────────────────
// Helper: Google Custom Search API
// ─────────────────────────────────────────────
async function googleSearch(query) {

  const response = await axios.post(
    "https://google.serper.dev/search",
    { q: query + " India law legal", num: 10 },
    {
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  const items = response.data.organic || [];

  return items.map(item => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet,
    source: item.displayedLink || ""
  }));
}

// ─────────────────────────────────────────────
// Static Pages
// ─────────────────────────────────────────────
app.get('/',             (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/login',        (req, res) => res.render('login'));
app.get('/register',     (req, res) => res.render('register'));
app.get('/about',        (req, res) => res.render('about'));
app.get('/contactus',    (req, res) => res.render('contactus'));
app.get('/help',         (req, res) => res.render('help'));
app.get('/simple',       (req, res) => res.render('simple'));
app.get('/professional', (req, res) => res.render('professional'));
app.get('/chat',         (req, res) => res.render('chat'));
app.get('/dashboard',    (req, res) => res.render('approach'));

// ─────────────────────────────────────────────
// Auth Routes
// ─────────────────────────────────────────────
app.post('/approach', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.render('error', { message: 'Username and password are required.' });
    const data = await dbConnection();
    await data.insertOne({ username, password });
    res.render('approach');
  } catch (err) {
    console.error('[REGISTER ERROR]', err);
    res.render('error', { message: 'Registration failed. Please try again.' });
  }
});

app.post('/authentication', async (req, res) => {
  try {
    const { username, password } = req.body;
    const data = await dbConnection();
    const user = await data.findOne({ username, password });
    if (user) {
      res.redirect('/dashboard');
    } else {
      res.render('error', { message: 'Invalid credentials. Please try again.' });
    }
  } catch (err) {
    console.error('[AUTH ERROR]', err);
    res.render('error', { message: 'Authentication failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────
// Search: Simple (JSON-based smart search)
// ─────────────────────────────────────────────
app.post('/search-json', (req, res) => {
  const query = (req.body.query || '').trim();
  if (!query)
    return res.render('results', {
      query: '',
      results: [{ title: 'Empty Query', snippet: 'Please enter a search term.', link: '#', source: '' }]
    });

  const laws = loadJSON('laws.json');
  let results = smartSearch(laws, query).map(({ _score, ...rest }) => ({
    title:   rest.title,
    snippet: rest.summary || rest.description || '',
    link:    `/law/${encodeURIComponent(rest.keyword)}`,
    source:  'Local Database',
  }));

  if (results.length === 0) {
    results = [{
      title:   'No results found',
      snippet: `No laws matched "${query}". Try keywords like "property", "marriage", "consumer rights", "income tax" etc.`,
      link:    '#',
      source:  ''
    }];
  }

  res.render('results', { query, results });
});

// ─────────────────────────────────────────────
// Search: Law Detail Page
// ─────────────────────────────────────────────
app.get('/law/:keyword', (req, res) => {
  const keyword = decodeURIComponent(req.params.keyword).toLowerCase();
  const laws = loadJSON('laws.json');

  let law = laws.find(l => l.keyword.toLowerCase() === keyword);
  if (!law) {
    law = laws.find(l =>
      l.keyword.toLowerCase().includes(keyword) ||
      keyword.includes(l.keyword.toLowerCase()) ||
      (l.aliases || []).some(a => a.toLowerCase() === keyword)
    );
  }

  if (law) {
    law.details = law.full_description ||
      `The ${law.title} covers "${law.keyword}". ${law.summary}`;
    res.render('lawDetails', { law });
  } else {
    res.status(404).render('error', { message: `No law found for: "${keyword}"` });
  }
});

// ─────────────────────────────────────────────
// Search: Professional — Google Custom Search API
// ─────────────────────────────────────────────
app.post('/search-scrape', async (req, res) => {
  const query = (req.body.query || '').trim();

  if (!query)
    return res.render('results', { query: '', results: [] });

  // Guard: keys not yet configured
  if (GOOGLE_API_KEY === 'PASTE_YOUR_API_KEY_HERE' || GOOGLE_CX === 'PASTE_YOUR_SEARCH_ENGINE_ID_HERE') {
    return res.render('results', {
      query,
      results: [{
        title:   '⚠️ Search Not Configured',
        snippet: 'Please add your Google API Key and Search Engine ID in app.js to enable Professional Search.',
        link:    '#',
        source:  ''
      }]
    });
  }

  try {
    const results = await googleSearch(query);

    if (results.length === 0) {
      return res.render('results', {
        query,
        results: [{
          title:   'No results found',
          snippet: `Google returned no results for "${query}". Try different keywords.`,
          link:    '#',
          source:  ''
        }]
      });
    }

    res.render('results', { query, results });

  } catch (error) {
    console.error('[GOOGLE SEARCH ERROR]', error?.response?.data || error.message);

    let message = 'Google Search failed. Please try again later.';
    if (error?.response?.status === 403)
      message = '❌ API key is invalid or daily quota exceeded (100/day free). Check Google Cloud Console.';
    else if (error?.response?.status === 400)
      message = '❌ Invalid Search Engine ID. Check your Programmable Search Engine dashboard.';

    res.render('results', {
      query,
      results: [{ title: 'Search Error', snippet: message, link: '#', source: '' }]
    });
  }
});

// ─────────────────────────────────────────────
// Chatbot: Smart multi-layer search
// ─────────────────────────────────────────────
app.post('/chatbot', (req, res) => {
  const userInput = (req.body.message || '').trim();
  if (!userInput) return res.json({ message: 'Please type a message.' });

  const responses = loadJSON('chatbot_responses.json');
  const laws      = loadJSON('laws.json');

  // Layer 1: Predefined chatbot responses
  const chatResponse = findChatbotResponse(responses, userInput);
  if (chatResponse) return res.json({ message: chatResponse });

  // Layer 2: Smart search in laws.json
  const matchedLaws = smartSearch(laws, userInput);
  if (matchedLaws.length > 0) {
    const law = matchedLaws[0];
    const message =
      `📋 *${law.title}*\n\n${law.summary}\n\n` +
      (law.penalties ? `⚖️ Penalties: ${law.penalties}\n\n` : '') +
      (law.helpful_links?.length ? `🔗 Helpful Links:\n${law.helpful_links.join('\n')}` : '');
    return res.json({ message });
  }

  // Layer 3: Fallback
  res.json({
    message:
      "I couldn't find specific information on that. Try asking about:\n" +
      "• Consumer rights\n• Property laws\n• Marriage & divorce\n" +
      "• Labour rights\n• Income tax\n• Cyber crime\n• RTI\n• Passport\n\n" +
      "Or type 'help' for guidance."
  });
});

// ─────────────────────────────────────────────
// API endpoints (for AJAX / frontend use)
// ─────────────────────────────────────────────
app.get('/api/laws', (req, res) => {
  res.json(loadJSON('laws.json'));
});

app.get('/api/search', (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.json([]);
  const laws = loadJSON('laws.json');
  const results = smartSearch(laws, query).map(({ _score, ...rest }) => rest);
  res.json(results);
});

// ─────────────────────────────────────────────
// 404 & Global Error Handlers
// ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).render('error', { message: 'Something went wrong. Please try again.' });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});