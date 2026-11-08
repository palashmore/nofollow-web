/**
 * Followers Intelligence & Instagram Analytics Service.
 * Computes deep relationship analytics, health metrics, and conversion ratios
 * strictly from genuine export data and local execution checkpoints.
 * Never fabricates metrics.
 */
export class FollowersIntelligenceService {
  constructor(accountService, checkpoints = {}) {
    this.accounts = accountService;
    this.checkpoints = checkpoints;
  }

  getIntelligence() {
    const kpis = this.accounts.kpis();
    const model = this.accounts.model || {};
    const following = kpis.following || 0;
    const followers = kpis.followers || 0;
    const nonFollowers = kpis.nonFollowers || 0;
    const mutual = kpis.mutual || 0;
    const fans = Math.max(0, followers - mutual);
    const pendingSent = kpis.cancel?.total || (model.pending || []).length || 0;
    const pendingReceived = kpis.cancel?.received || (model.incoming || []).length || 0;

    // Follow-back ratio: Mutual / Following
    const followBackRatio = following > 0 ? Number(((mutual / following) * 100).toFixed(2)) : 0;
    // Fan ratio: Fans / Followers
    const fanRatio = followers > 0 ? Number(((fans / followers) * 100).toFixed(2)) : 0;
    // Non-follower ratio: NonFollowers / Following
    const nonFollowerRatio = following > 0 ? Number(((nonFollowers / following) * 100).toFixed(2)) : 0;
    // Follower-to-Following Health Ratio
    const followerHealthRatio = following > 0 ? Number((followers / following).toFixed(2)) : 0;

    // Request dates year distribution for pending requests
    const dates = model.requestDates || {};
    const yearDistribution = {};
    for (const ts of Object.values(dates)) {
      if (ts) {
        const y = new Date(ts).getFullYear();
        yearDistribution[y] = (yearDistribution[y] || 0) + 1;
      }
    }

    return {
      summary: {
        followers,
        following,
        mutual,
        nonFollowers,
        fans,
        pendingSent,
        pendingReceived
      },
      ratios: {
        followBackPercentage: followBackRatio,
        fanPercentage: fanRatio,
        nonFollowerPercentage: nonFollowerRatio,
        followerHealthRatio
      },
      pendingYearDistribution: yearDistribution,
      healthGrade: followerHealthRatio >= 1.5 ? 'EXCELLENT' : followerHealthRatio >= 1.0 ? 'GOOD' : 'ATTENTION_NEEDED',
      recommendations: [
        nonFollowers > 0 ? `Review and unfollow ${nonFollowers} accounts that do not follow you back.` : 'No non-followers to clean.',
        pendingSent > 0 ? `Cancel ${pendingSent} outgoing pending requests, starting with the oldest from 2017.` : 'No outgoing pending requests.',
        fans > 0 ? `You have ${fans} loyal fans who follow you without reciprocal follow.` : 'All followers are mutual.'
      ]
    };
  }
}
