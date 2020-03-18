const https = require('https');

// https://stackoverflow.com/a/9677462
const escapeHTML = (function() {
  const MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&#34;',
    "'": '&#39;'
  };
  
  const repl = function(c) { return MAP[c]; };
    return function(s) {
      return s.replace(/[&<>'"]/g, repl);
    };
  }
)();

const gotoBaseUrl = 'https://tvanier.netlify.com/goto';

const generateHTML = ({ product, subject, description, organizerName, url, imageUrl, redirectUrl, twitterLabels = [] }) =>  {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">

        <link rel="icon" href="${gotoBaseUrl}/favicon.ico">
        <link rel="icon" type="image/png" sizes="32x32" href="${gotoBaseUrl}/img/daisy-x32.png">
        <link rel="icon" type="image/png" sizes="16x16" href="${gotoBaseUrl}/img/daisy-x16.png">

        <title>GoTo</title>

        <meta property="og:type" content="website">
        <meta property="og:site_name" content="GoTo">
        <meta property="og:description" content="${description}">
        <meta property="og:title" content="${product}${subject ? ' - ' + subject : ''}">
        <meta property="og:url" content="${redirectUrl}">
        <meta property="og:image" content="${imageUrl}">
        
        <meta name="twitter:title" value="${product}${subject ? ' - ' + subject : ''}">
        <meta name="twitter:description" value="${description}">
        <meta name="twitter:url" value="${redirectUrl}">
        <meta name="twitter:image" content="${imageUrl}">
        ${twitterLabels.join('\n')}

        <meta name="description" content="${description}">
        <meta name="author" content="${organizerName || ''}">
      </head>

      <body>
        <noscript>
          <h3>${product} - ${subject}</h3>
          If you are not automatically redirected, please click this link<br >
          <a href="${redirectUrl}">${redirectUrl}</a>
        </noscript>

        <script>
          window.location.replace('${redirectUrl}');
        </script>
      </body>
    </html>`;
}

exports.handler = async (event) => {
  let response;

  try {
    const match = /\/(join|meet|connect|register)\/([\w-_]+)$/.exec(event.path.toLowerCase());
  
    if (match) {
      const action = match[1];
      const id = match[2];

      if (action === 'join') {
        response = await handleMeeting(id);
      } else if (action === 'meet' || action === 'connect') {
        const custom = {
          product: 'GoToConnect',
          redirectUrl: `https://my.jive.com/meet/${id}`,
          imageUrl: `${gotoBaseUrl}/img/g2c-logo-lmi-text-side.png`
        };

        response = await handleMeeting(id, custom);
      } else if (action === 'register') {
        response = await handleWebinar(id);
      }
    }
  } catch (error) {
    response = {
      statusCode: error.statusCode || 500,
      body: String(error)
    }
  }

  return {
    statusCode: 404,
    body: `No meeting or webinar found from ${event.path}`,
    ...(response || {})
  };
}

const fetch = async (url, options) => {
  return new Promise((resolve, reject) => {
    const req = https.request(options || url, (res) => {
      const response = {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        headers: res.headers
      };

      if (res.statusCode !== 200) {
        reject(response)
        return
      }

      let resData = '';
      res.on('data', (chunk) => resData += chunk);
  
      res.on('end', () => {
        response.body = Buffer.from(resData).toString('utf8');
        resolve(response);
      });

      res.on('error', (error) => {
        response.body = String(error)
        reject(response);
      });
    });

    req.on('error', reject);
    req.end();
  });
}

const fetchJSON = async (url, options) => {
  const response = await fetch(url, options);
  return JSON.parse(response.body);
}

const handleMeeting = async (meetingId = '', custom = {}) => {
  const baseUrl = 'https://global.gotomeeting.com/rest/2';

  let profile;
  const digits = meetingId.replace(/\D/g, '');
  if (digits.length !== 9) {
    // try profile, fail if not found
    profile = await fetchJSON(`${baseUrl}/profiles/${meetingId}`);
    meetingId = profile.meetingId;
  }

  let {
    product,
    redirectUrl,
    imageUrl
  } = {
    product: 'GoToMeeting',
    redirectUrl: `https://global.gotomeeting.com/join/${meetingId}`,
    imageUrl: `${gotoBaseUrl}/img/g2m-logo-lmi-text-side.png`,
    ...custom
  };
  
  let meetingInfo = {}
  try {
    meetingInfo = await fetchJSON(`${baseUrl}/meetings/${meetingId}`);
  } catch (e) {
    if (e.statusCode === 404) {
      meetingInfo = { description: `Sorry, the meeting with ID ${meetingId} was not found`}
    } else {
      meetingInfo = { description: e.body }
    }
  }
  
  let {
    subject = '',
    description = '',
    organizer = {},
    audio
  } = meetingInfo;

  subject = escapeHTML(subject);
  let organizerName = `${organizer.firstName || ''} ${organizer.lastName || ''}`;

  // image url: avatar or profile or default logo
  let avatarUrl
  try {
    const userKey = organizer.userKey || (profile && profile.userKey)
    if (userKey) {
      const options = {
        method: 'HEAD',
        hostname: 'avatars.servers.getgo.com',
        path: `/${userKey}_medium.jpg`
      };

      const response = await fetch(options);
      if (response.headers['x-amz-meta-type'] !== 'default') {
        avatarUrl = `https://${options.hostname}${options.path}`;
      }
    }
    
    if (!avatarUrl && meetingInfo.profileId && !profile) {
      profile = await fetchJSON(`${baseUrl}/profiles/${meetingInfo.profileId}`);
      avatarUrl = profile.avatarUrl || avatarUrl
    }
  } catch (e) {
    // ignore
  } finally {
    imageUrl = avatarUrl || (profile && profile.avatarUrl ? profile.avatarUrl : imageUrl)
  }

  if (profile && profile.title) {
    organizerName += `, ${profile.title}`
  }
  organizerName = escapeHTML(organizerName);

  let twitterLabels = [];
  twitterLabels.push(`<meta name="twitter:label1" value="Organizer">`);
  twitterLabels.push(`<meta name="twitter:data1" value="${organizerName}">`);

  if (profile && profile.location) {
    twitterLabels.push(`<meta name="twitter:label2" value="Location">`);
    twitterLabels.push(`<meta name="twitter:data2" value="${profile.location}">`);
  }

  if (audio) {
    let audioText
    switch (audio.audioType) {
      case 'voip': audioText = 'Join from your computer.'; break;
      case 'pstn': audioText = 'Join by phone.'; break;
      case 'voipAndPstn': audioText = 'Join from your computer or by phone.'; break;
      case 'private':
      default: audioText = ''; break;
    }

    if (/pstn/i.test(audio.audioType)) {
      const { phoneNumbers = [], dialOutInfo = [] } = audio
      const countries = phoneNumbers.reduce((acc, country) => {
        acc[country.country] = true
        return acc
      }, {})
      // const dialInCountries = Object.keys(countries)
      let tollFree = phoneNumbers.filter(phoneNumber => phoneNumber.tollFree)

      if (dialOutInfo.length) {
        audioText += ` Let GoTo call you in ${dialOutInfo.length} countries.`
      }

      if (tollFree.length) {
        audioText += ` Dial In Toll Free from ${tollFree.length} countries.`;
      }
    }

    description += audioText
  }

  description = escapeHTML(description);

  const html = generateHTML({
    product,
    subject,
    description,
    organizerName,
    url: redirectUrl, // `${gotoBaseUrl}/#/meeting/${meetingId}/attend`,
    imageUrl,
    redirectUrl,
    twitterLabels
  });

  return {
    statusCode: 200,
    body: html
  };
};

const handleWebinar = async (webinarKey) => {
  webinarKey = webinarKey.replace(/\W/g, '');

  const baseUrl = 'https://global.gotowebinar.com/api/V2';
  const includes = [
    'branding',
    'organizerInfo'
  ];
  
  const webinarInfo = await fetchJSON(`${baseUrl}/webinars/${webinarKey}?includes=${includes.join(',')}`);

  let {
    subject = '',
    organizerName = '',
    organizerEmail = '',
    description = '',
    branding = {},
    registrationUrl: redirectUrl= '',
    timeZone,
    locale,
    webinarTimes = []
  } = webinarInfo;

  const product = 'GoToWebinar';
  subject = escapeHTML(subject);
  description = escapeHTML(description);
  organizerName += organizerEmail ? ` - ${organizerEmail}` : ''
  organizerName = escapeHTML(organizerName);

  let timeLabel = 'Time'
  let time = '';
  let webinarTime
  if (webinarTimes.length === 1) {
    webinarTime = webinarTimes[0];
  } else if (webinarTimes.length > 1) {
    const now = Date.now();
    webinarTime = webinarTimes.find(wt => Date.parse(wt.startTime) >= now);

    if (webinarTime) {
      timeLabel = 'Next Time';
    } else {
      webinarTime = webinarTimes[webinarTimes.length - 1];
    }
  }

  if (webinarTime) {
    const standardLocale = locale.replace(/_/g, '-');

    const startTime = new Date(webinarTime.startTime);
    const endTime = new Date(webinarTime.endTime);

    const startTimeStr = startTime.toLocaleString(standardLocale, {
      year: 'numeric', month: 'long', weekday: 'long', day: 'numeric',
      hour: 'numeric', minute: 'numeric',
      timeZone
    });
    const endTimeStr = endTime.toLocaleTimeString(standardLocale, {
      hour: 'numeric', minute: 'numeric',
      timeZone, timeZoneName: 'short'
    });

    time = `${startTimeStr} - ${endTimeStr}`;

    redirectUrl = webinarTime.registrationUrl || redirectUrl;
  }

  const { logoImageUrl, webinarPresenters = [] } = branding;
  let imageUrl;
  if (logoImageUrl) {
    imageUrl = branding.logoImageUrl;
  } else if (webinarPresenters.length === 1) {
    imageUrl = webinarPresenters[0].imageUrl;
  }
  imageUrl = imageUrl || `${gotoBaseUrl}/img/g2w-logo-lmi-text-side.png`;

  const twitterLabels = [
    `<meta name="twitter:label1" value="Organizer">`,
    `<meta name="twitter:data1" value="${organizerName}">`
  ];

  if (time) {
    twitterLabels.push(`<meta name="twitter:label2" value="${timeLabel}">`);
    twitterLabels.push(`<meta name="twitter:data2" value="${time}">`);
  }

  if (webinarPresenters.length > 0) {
    const presenters = escapeHTML(webinarPresenters.map(p => p.name).join(', '));
    twitterLabels.push(`<meta name="twitter:label3" value="Presenters">`);
    twitterLabels.push(`<meta name="twitter:data3" value="${presenters}">`);
  }

  const html = generateHTML({
    product,
    subject,
    description,
    organizerName,
    url: redirectUrl, // `${gotoBaseUrl}/#/webinar/${webinarKey}/register`,
    imageUrl,
    redirectUrl,
    twitterLabels
  });

  return {
    statusCode: 200,
    body: html
  };
};
