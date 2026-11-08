// Controlled stand-ins for Instagram pages and export files. Nothing here talks to the real site.

export const rel = (name, kind) => kind === 'bioWords'
  ? rel(name, 'following').replace('</header>', '</header><p>my bio: no suspicious activity, try again later!</p>')
  : ({
  following: `<main><header><h2>${name}</h2><button id="b">Following<svg width="8" height="8" aria-label="Down chevron icon"><title>Down chevron icon</title></svg></button><button>Message</button></header>
    <script>
      const b=document.getElementById('b');
      b.onclick=()=>{const d=document.createElement('div');d.setAttribute('role','dialog');
        d.innerHTML='<div>Mute</div><div id="u">Unfollow</div>';document.body.append(d);
        document.getElementById('u').onclick=()=>{d.remove();b.textContent='Follow';fetch('/__unfollowed/${name}');};};
    </script></main>`,
  requestedMenu: `<main><header><h2>${name}</h2><button id="b">Requested<svg width="8" height="8" aria-label="Down chevron icon"><title>Down chevron icon</title></svg></button></header>
    <script>
      const b=document.getElementById('b');
      b.onclick=()=>{const d=document.createElement('div');d.setAttribute('role','dialog');
        d.innerHTML='<div id="u">Unfollow</div><div id="c">Cancel</div>';document.body.append(d);
        document.getElementById('c').onclick=()=>d.remove();
        document.getElementById('u').onclick=()=>{d.remove();b.textContent='Follow';fetch('/__unfollowed/${name}');};};
    </script></main>`,
  notFollowing: `<main><header><h2>${name}</h2><button>Follow</button></header><p>Follows you</p></main>`,
  requested: `<main><header><h2>${name}</h2><button>Requested</button></header></main>`,
  unavailable: `<body><div>Sorry, this page isn't available.</div><div>The link you followed may be broken.</div></body>`,
  blocked: `<main><header><h2>${name}</h2></header><div role="dialog">Action Blocked. Try Again Later. We restrict certain activity.</div></main>`,
  captcha: `<body><div role="dialog">Please complete this security check to confirm you're a human.</div></body>`,
  login: `<body><form><input name="username"><input name="password" type="password"></form></body>`,
  blank: `<body></body>`,
})[kind];

export const snap = (over = {}) => ({ url: 'https://www.instagram.com/x/', buttons: [], bodyText: '', dialogText: '', hasLoginForm: false, followsYou: false, isPrivate: false, ...over });

const link = (u, d = 'Nov 07, 2026 5:56 am') => `<div class="pam"><h2>${u}</h2><div><a target="_blank" href="https://www.instagram.com/_u/${u}">https://www.instagram.com/_u/${u}</a></div><div>${d}</div></div>`;
export const html = (users, date) => `<html><body>${users.map(u => link(u, date)).join('')}</body></html>`;
export const followersHtml = (users, date) => `<html><body>${users.map(u => `<div><a target="_blank" href="https://www.instagram.com/${u}">${u}</a><div>${date || 'Nov 07, 2026 5:56 am'}</div></div>`).join('')}</body></html>`;
export const json = (users, ts = 1762500000) => JSON.stringify(users.map(u => ({ title: '', media_list_data: [], string_list_data: [{ href: `https://www.instagram.com/${u}`, value: u, timestamp: ts }] })));
export const followingJson = users => JSON.stringify({ relationships_following: users.map(u => ({ title: u, string_list_data: [{ href: `https://www.instagram.com/_u/${u}`, timestamp: 1762500000 }] })) });
export const tableHtml = urls => `<html><body>${urls.map(u => `<div class="_a6-p"><table><tr><td class="_a6_q">URL</td><td class="_2piu _a6_r">${u}</td></tr><tr><td class="_a6_q">Name</td><td>x</td></tr></table></div>`).join('')}</body></html>`;

export const homePage = kind => ({
  in: `<body><nav><a href="/explore/">Explore</a><a href="/tester/"><img alt="tester's profile picture"></a></nav><main>Feed</main></body>`,
  login: `<body><form><input name="username"><input name="password" type="password"></form></body>`,
  security: `<body><nav><a href="/explore/">Explore</a></nav><div role="dialog">We restrict certain activity to protect our community. Please confirm it's you.</div></body>`,
  blank: `<body></body>`,
})[kind];
