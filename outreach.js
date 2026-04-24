#!/usr/bin/env node
/**
 * Reset Co Outreach Manager
 *
 * Commands:
 *   node outreach.js send      — Send intros to all "New" leads in Notion
 *   node outreach.js followup  — Send follow-ups to "Contacted" leads (5+ days, no reply)
 *   node outreach.js scan      — Check Gmail for replies, update Notion statuses
 *   node outreach.js close     — Mark "Follow Up Sent" leads with no reply (7+ days) as "No Response"
 *   node outreach.js status    — Show a summary of all leads by status
 */

const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');

// --- Config ---
const GMAIL_USER = 'info.resetco@gmail.com';
const GMAIL_PASS = 'luhh cffh xsli tqze';
const NOTION_TOKEN = 'ntn_b22687791872wPktcZ2fFATdnz1A5x4xQgGEnjn3iMH4t6';
const DATA_SOURCE_ID = '3480873a-d2b3-80c6-bf1f-000b78adb7ba';
const NOTION_VERSION = '2025-09-03';

const DAYS_BEFORE_FOLLOWUP = 5;
const DAYS_BEFORE_CLOSE = 7;
const SEND_DELAY_MS = 4000;

// --- Gmail SMTP ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

// --- Helpers ---
function getGreeting() {
  return new Date().getHours() < 12 ? 'Good morning,' : 'Good afternoon,';
}

function daysAgo(dateStr) {
  if (!dateStr) return 999;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function loadTemplate(filename) {
  let html = fs.readFileSync(path.join(__dirname, 'emails', filename), 'utf8');
  html = html.replace(/Good morning,/g, getGreeting());
  html = html.replace(/Hello,/g, getGreeting());
  return html;
}

// --- Notion API ---
async function notionRequest(method, endpoint, body) {
  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function queryLeads(statusFilter) {
  const leads = [];
  let cursor = undefined;
  while (true) {
    const body = {
      page_size: 100,
      filter: { property: 'Status', status: { equals: statusFilter } },
    };
    if (cursor) body.start_cursor = cursor;
    const data = await notionRequest('POST', `data_sources/${DATA_SOURCE_ID}/query`, body);
    for (const page of (data.results || [])) {
      const props = page.properties;
      leads.push({
        id: page.id,
        name: (props['Lead Name']?.title?.[0]?.plain_text) || 'Unknown',
        email: props['Email']?.email || '',
        phone: props['Phone']?.phone_number || '',
        serviceType: (props['Service Type']?.multi_select || []).map(s => s.name),
        suburb: props['Suburb']?.rich_text?.[0]?.plain_text || '',
        status: props['Status']?.status?.name || '',
        introSentAt: props['Intro Sent At']?.date?.start || '',
        followUpSentAt: props['Follow Up Sent At']?.date?.start || '',
        emailTemplate: props['Email Template']?.rich_text?.[0]?.plain_text || '',
        notes: props['Notes']?.rich_text?.[0]?.plain_text || '',
      });
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return leads;
}

async function queryAllLeads() {
  const leads = [];
  let cursor = undefined;
  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionRequest('POST', `data_sources/${DATA_SOURCE_ID}/query`, body);
    for (const page of (data.results || [])) {
      const props = page.properties;
      leads.push({
        id: page.id,
        name: (props['Lead Name']?.title?.[0]?.plain_text) || 'Unknown',
        email: props['Email']?.email || '',
        status: props['Status']?.status?.name || '',
        introSentAt: props['Intro Sent At']?.date?.start || '',
        followUpSentAt: props['Follow Up Sent At']?.date?.start || '',
      });
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return leads;
}

async function updateLead(pageId, properties) {
  return notionRequest('PATCH', `pages/${pageId}`, { properties });
}

// --- Pick template based on service type ---
function pickTemplate(serviceTypes) {
  const types = (serviceTypes || []).map(t => t.toLowerCase());
  if (types.some(t => t.includes('office') || t.includes('coworking'))) {
    return { key: '3', file: '03-office-intro.html', subject: 'Office clean' };
  }
  return { key: '1', file: '01-intro-hospitality.html', subject: 'A more thoughtful approach to cleaning your space' };
}

// --- Commands ---

async function cmdSend() {
  const leads = await queryLeads('New');
  if (leads.length === 0) {
    console.log('No "New" leads to send to.');
    return;
  }
  console.log(`Found ${leads.length} new leads.\n`);

  let sent = 0;
  for (const lead of leads) {
    if (!lead.email) {
      console.log(`  SKIP  ${lead.name}: no email`);
      continue;
    }

    const template = pickTemplate(lead.serviceType);
    const html = loadTemplate(template.file);

    try {
      await transporter.sendMail({
        from: '"Reset Co" <info.resetco@gmail.com>',
        to: lead.email,
        subject: template.subject,
        html,
      });

      await updateLead(lead.id, {
        'Status': { status: { name: 'Contacted' } },
        'Intro Sent At': { date: { start: today() } },
        'Email Template': { rich_text: [{ text: { content: template.key } }] },
      });

      sent++;
      console.log(`  SENT  ${lead.name} (${lead.email}) — template ${template.key}`);
      await sleep(SEND_DELAY_MS);
    } catch (err) {
      console.error(`  FAIL  ${lead.name}: ${err.message}`);
    }
  }
  console.log(`\nSent ${sent} intro emails.`);
}

async function cmdFollowUp() {
  const leads = await queryLeads('Contacted');
  if (leads.length === 0) {
    console.log('No "Contacted" leads ready for follow-up.');
    return;
  }

  const ready = leads.filter(l => daysAgo(l.introSentAt) >= DAYS_BEFORE_FOLLOWUP);
  if (ready.length === 0) {
    console.log(`${leads.length} contacted leads, but none are ${DAYS_BEFORE_FOLLOWUP}+ days old yet.`);
    return;
  }

  console.log(`Found ${ready.length} leads ready for follow-up (${DAYS_BEFORE_FOLLOWUP}+ days since intro).\n`);

  let sent = 0;
  for (const lead of ready) {
    if (!lead.email) continue;

    const html = loadTemplate('02-follow-up.html');

    try {
      await transporter.sendMail({
        from: '"Reset Co" <info.resetco@gmail.com>',
        to: lead.email,
        subject: 'A gentle follow up',
        html,
      });

      await updateLead(lead.id, {
        'Status': { status: { name: 'Follow Up Sent' } },
        'Follow Up Sent At': { date: { start: today() } },
      });

      sent++;
      console.log(`  SENT  ${lead.name} (${lead.email}) — follow up`);
      await sleep(SEND_DELAY_MS);
    } catch (err) {
      console.error(`  FAIL  ${lead.name}: ${err.message}`);
    }
  }
  console.log(`\nSent ${sent} follow-up emails.`);
}

async function cmdScan() {
  console.log('Scanning Gmail inbox for replies...\n');

  // Get all leads that are Contacted or Follow Up Sent
  const contacted = await queryLeads('Contacted');
  const followedUp = await queryLeads('Follow Up Sent');
  const allActive = [...contacted, ...followedUp];

  if (allActive.length === 0) {
    console.log('No active leads to scan for.');
    return;
  }

  const emailToLead = {};
  for (const lead of allActive) {
    if (lead.email) emailToLead[lead.email.toLowerCase()] = lead;
  }

  console.log(`Checking replies for ${Object.keys(emailToLead).length} active leads...`);

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    logger: false,
  });

  let replied = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Search last 30 days of emails
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const messages = await client.search({ since });

      if (messages.length > 0) {
        for await (const msg of client.fetch(messages, { envelope: true })) {
          const from = (msg.envelope.from || []).map(f => f.address?.toLowerCase()).filter(Boolean);

          for (const senderEmail of from) {
            if (emailToLead[senderEmail]) {
              const lead = emailToLead[senderEmail];
              await updateLead(lead.id, {
                'Status': { status: { name: 'Replied' } },
                'Notes': { rich_text: [{ text: { content: `Replied on ${today()}. ${lead.notes || ''}`.trim() } }] },
              });
              replied++;
              console.log(`  REPLY  ${lead.name} (${senderEmail})`);
              delete emailToLead[senderEmail];
            }
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error('IMAP error:', err.message);
    console.log('\nIf this fails, make sure IMAP is enabled in Gmail settings:');
    console.log('  Gmail > Settings > See all settings > Forwarding and POP/IMAP > Enable IMAP');
  }

  console.log(`\n${replied} leads marked as "Replied".`);
  console.log(`${Object.keys(emailToLead).length} active leads with no reply yet.`);
}

async function cmdClose() {
  const leads = await queryLeads('Follow Up Sent');
  if (leads.length === 0) {
    console.log('No "Follow Up Sent" leads to check.');
    return;
  }

  const stale = leads.filter(l => daysAgo(l.followUpSentAt) >= DAYS_BEFORE_CLOSE);
  if (stale.length === 0) {
    console.log(`${leads.length} follow-up leads, but none are ${DAYS_BEFORE_CLOSE}+ days old yet.`);
    return;
  }

  console.log(`Closing ${stale.length} leads with no response (${DAYS_BEFORE_CLOSE}+ days since follow-up).\n`);

  let closed = 0;
  for (const lead of stale) {
    await updateLead(lead.id, {
      'Status': { status: { name: 'No Response' } },
      'Notes': { rich_text: [{ text: { content: `No response after follow-up. Closed ${today()}. ${lead.notes || ''}`.trim() } }] },
    });
    closed++;
    console.log(`  CLOSED  ${lead.name} (${lead.email})`);
  }
  console.log(`\n${closed} leads moved to "No Response".`);
}

async function cmdStatus() {
  const leads = await queryAllLeads();
  const counts = {};
  for (const lead of leads) {
    const s = lead.status || 'Unknown';
    counts[s] = (counts[s] || 0) + 1;
  }

  console.log(`\nReset Co Outreach — ${leads.length} total leads\n`);
  const order = ['New', 'Contacted', 'Follow Up Sent', 'Replied', 'No Response', 'Proposal Sent', 'Negotiating', 'Won', 'Lost'];
  for (const status of order) {
    if (counts[status]) {
      const bar = '█'.repeat(Math.min(counts[status], 40));
      console.log(`  ${status.padEnd(18)} ${String(counts[status]).padStart(4)}  ${bar}`);
    }
  }
  console.log('');
}

// --- Main ---
const command = process.argv[2];
switch (command) {
  case 'send':
    cmdSend();
    break;
  case 'followup':
    cmdFollowUp();
    break;
  case 'scan':
    cmdScan();
    break;
  case 'close':
    cmdClose();
    break;
  case 'status':
    cmdStatus();
    break;
  default:
    console.log('Reset Co Outreach Manager');
    console.log('');
    console.log('Usage: node outreach.js <command>');
    console.log('');
    console.log('Commands:');
    console.log('  send      Send intros to all "New" leads');
    console.log('  followup  Send follow-ups to "Contacted" leads (5+ days, no reply)');
    console.log('  scan      Check Gmail for replies, move leads to "Replied"');
    console.log('  close     Mark stale "Follow Up Sent" leads as "No Response" (7+ days)');
    console.log('  status    Show lead counts by status');
    console.log('');
    console.log('Workflow:');
    console.log('  1. node outreach.js send       — blast intros to new leads');
    console.log('  2. wait 5 days');
    console.log('  3. node outreach.js scan       — check for replies first');
    console.log('  4. node outreach.js followup   — send follow-ups to non-repliers');
    console.log('  5. wait 7 days');
    console.log('  6. node outreach.js scan       — check for replies again');
    console.log('  7. node outreach.js close      — shelve non-responders');
    console.log('  8. node outreach.js status     — see where everything stands');
    break;
}
