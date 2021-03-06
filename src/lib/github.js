const octokit = require('@octokit/rest')()
const { readFileSync } = require('fs');

checkRateLimits = (headers) => {
  if (headers['x-ratelimit-remaining'] == 0) {
    var difference = new Date(headers['x-ratelimit-reset'] * 1000) - new Date();
    var minutes = Math.floor((difference / 1000) / 60);
    console.log('Exaushted Github API requests.');
    console.log(`Provide Github Token to get higher limits or check back in ${minutes} ${minutes > 1 ? 'minutes' : 'minute'}.`);
    process.exit()
  }
}

module.exports.authenticate = (token) => octokit.authenticate({
  type: 'token',
  token,
})

const getRepos = async (org, exclude) => {

  try {
    let response = await octokit.repos.getForOrg({
      org: org,
      type: 'public',
    })
    var { data } = response;
    while (octokit.hasNextPage(response)) {
      response = await octokit.getNextPage(response)
      data = data.concat(response.data)
    }
  } catch (error) {
    if (error.code === 403) {
      checkRateLimits(error.headers);
    }
  }

  repos = data.map(x => x.name)
  // filter by exclude list
  repos = repos.filter(repo => !exclude || !exclude.repos.includes(repo));

  return repos
}

const getRepoContributors = async (owner, repo) => {
  contributors = {}
  try {
    let response = await octokit.repos.getContributors({
      owner: owner,
      repo: repo
    })
    var { data } = response;
    while (octokit.hasNextPage(response)) {
      response = await octokit.getNextPage(response)
      data = data.concat(response.data)
    }
  } catch (error) {
    if (error.code === 403) {
      checkRateLimits(error.headers);
    }
  }
  data.map(x => contributors[x.id] = x.contributions);
  return contributors
}

const getUserData = async (id) => {
  let { data } = await octokit.users.getById({ id });
  return {
    'user': data.login,
    'name': data.name,
    'avatar': data.avatar_url,
    'bio': data.bio
  }
}

module.exports.getOrgContributors = async (owner, top, excludePath) => {

  var orgContributors = {}
  if (excludePath) {
    exclude = JSON.parse(readFileSync(excludePath, 'utf8'));
  } else {
    exclude = null;
  }
  const repos = await getRepos(owner, exclude)

  for (const repo of repos) {
    console.log('Getting contributors for', repo);
    const repoContributors = await getRepoContributors(owner, repo);

    for (const [userid, contrib_count] of Object.entries(repoContributors)) {
      if (userid in orgContributors) {
        orgContributors[userid]['contrib_count'] += contrib_count
        orgContributors[userid]['repos'].push(repo)
      } else {
        orgContributors[userid] = {};
        orgContributors[userid]['contrib_count'] = contrib_count;
        orgContributors[userid]['repos'] = [];
        orgContributors[userid]['repos'].push(repo);
      }
    }
  }

  // breakdown the dict and sort it by contribution
  let contributors = Object.keys(orgContributors).map(function (key) {
    return { id: key, contrib_count: this[key]['contrib_count'], repos: this[key]['repos'] };
  }, orgContributors);

  // sort by contribution count
  contributors.sort(function (u1, u2) { return u2.contrib_count - u1.contrib_count; });

  // slice contributors list to count + user exclude list length
  contributors = contributors.slice(0, parseInt(top) + parseInt(exclude !== null ? exclude.users.length : 0));

  // get user data
  contributors = await Promise.all(contributors.map(async contributor => {
    let user = await getUserData(contributor.id);
    return { ...user, ...contributor };
  }));

  // filter by exclude list
  contributors = contributors.filter(contributor => !exclude || !exclude.users.includes(contributor.user));

  // Slice contributors to max count
  contributors = contributors.slice(0, parseInt(top));

  return contributors;
}
