const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'info.resetco@gmail.com',
    pass: 'luhh cffh xsli tqze',
  },
});

const templates = {
  '1': { file: '01-intro-hospitality.html', subject: 'A more thoughtful approach to cleaning your space' },
  '2': { file: '02-follow-up.html', subject: 'A gentle follow up' },
  '3': { file: '03-office-intro.html', subject: 'Office clean' },
  '4': { file: '04-proposal.html', subject: 'Cleaning proposal for your space' },
};

function getGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning,' : 'Good afternoon,';
}

async function sendEmail(to, templateKey, customSubject) {
  const template = templates[templateKey];
  if (!template) {
    console.error(`Unknown template: ${templateKey}. Use 1, 2, 3, or 4.`);
    console.log('\nTemplates:');
    console.log('  1 = Intro (hospitality/retail)');
    console.log('  2 = Follow up');
    console.log('  3 = Office intro');
    console.log('  4 = Proposal');
    process.exit(1);
  }

  let html = fs.readFileSync(path.join(__dirname, 'emails', template.file), 'utf8');

  // Replace greeting based on time of day
  const greeting = getGreeting();
  html = html.replace(/Good morning,/g, greeting);
  html = html.replace(/Hello,/g, greeting);

  const subject = customSubject || template.subject;

  try {
    const info = await transporter.sendMail({
      from: '"Reset Co" <info.resetco@gmail.com>',
      to: to,
      subject: subject,
      html: html,
    });
    console.log(`SENT to ${to}`);
    console.log(`  Template: ${template.file}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Greeting: ${greeting}`);
    console.log(`  ID: ${info.messageId}`);
  } catch (err) {
    console.error(`FAILED:`, err.message);
  }
}

// Usage: node send-email.js <to> <template> [custom subject]
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node send-email.js <email> <template number> [custom subject]');
  console.log('');
  console.log('Templates:');
  console.log('  1 = Intro (hospitality/retail)');
  console.log('  2 = Follow up');
  console.log('  3 = Office intro');
  console.log('  4 = Proposal');
  console.log('');
  console.log('Examples:');
  console.log('  node send-email.js hello@cafe.com 1');
  console.log('  node send-email.js manager@office.com 3');
  console.log('  node send-email.js john@venue.com 4 "Cleaning proposal for The Grand"');
  process.exit(0);
}

sendEmail(args[0], args[1], args[2]);
