import express from 'express';

export function createTokenRoutes({ tokenManager, logger }) {
  const router = express.Router();

  router.get('/top', async (req, res) => {
    try {
      const viewMode = req.query.viewMode || 'all-time';
      const top10 = tokenManager.getTop10(viewMode);
      const mvpData = tokenManager.getMVP(viewMode);

      res.json({
        top10: top10.map((token, index) => {
          let netPercent = 0;
          if (token.mcTenSecondsAgo !== null && token.mcTenSecondsAgo > 0) {
            netPercent = ((token.currentMc - token.mcTenSecondsAgo) / token.mcTenSecondsAgo) * 100;
          }

          const isMVP = mvpData && token.contractAddress === mvpData.address;

          return {
            ...token,
            rank: index + 1,
            name: token.symbol && token.symbol !== 'UNKNOWN' ? token.symbol : token.name,
            multiplier: (token.peakMultiplier).toFixed(2) + 'x',
            currentMultiplier: (token.currentMc / token.spottedMc).toFixed(2) + 'x',
            netPercent: parseFloat(netPercent.toFixed(2)),
            isMVP: isMVP
          };
        }),
        mvp: mvpData ? {
          address: mvpData.address,
          name: mvpData.token.symbol || mvpData.token.name,
          fullName: mvpData.token.name,
          score: parseFloat(mvpData.score.toFixed(2)),
          health: parseFloat((mvpData.health * 100).toFixed(1)),
          components: {
            buyPressure: {
              raw: parseFloat(mvpData.components.buyPressure.raw.toFixed(3)),
              weighted: parseFloat(mvpData.components.buyPressure.weighted.toFixed(2)),
              weight: mvpData.components.buyPressure.weight
            },
            netBuyVolume: {
              raw: parseFloat(mvpData.components.netBuyVolume.raw.toFixed(2)),
              weighted: parseFloat(mvpData.components.netBuyVolume.weighted.toFixed(2)),
              weight: mvpData.components.netBuyVolume.weight
            },
            txnsVelocity: {
              raw: mvpData.components.txnsVelocity.raw,
              weighted: parseFloat(mvpData.components.txnsVelocity.weighted.toFixed(2)),
              weight: mvpData.components.txnsVelocity.weight
            },
            priceMomentum: {
              raw: parseFloat(mvpData.components.priceMomentum.raw.toFixed(2)),
              weighted: parseFloat(mvpData.components.priceMomentum.weighted.toFixed(2)),
              weight: mvpData.components.priceMomentum.weight
            },
            sseMomentum: {
              raw: parseFloat(mvpData.components.sseMomentum.raw.toFixed(3)),
              weighted: parseFloat(mvpData.components.sseMomentum.weighted.toFixed(2)),
              weight: mvpData.components.sseMomentum.weight
            }
          },
          acceleration: mvpData.acceleration ? {
            mc: parseFloat((mvpData.acceleration.mcAcceleration * 100).toFixed(2)),
            volume: parseFloat((mvpData.acceleration.volumeAcceleration * 100).toFixed(2))
          } : null,
          currentMc: mvpData.token.currentMc,
          peakMc: mvpData.token.peakMc,
          volume24h: mvpData.token.volume24h,
          logoUrl: mvpData.token.logoUrl,
          contractAddress: mvpData.token.contractAddress,
          hasData: mvpData.hasData,
          dataPoints: mvpData.dataPoints,
          metricsFresh: mvpData.metricsFresh
        } : null,
        monitoringCount: tokenManager.trackedTokens.size,
        tierInfo: tokenManager.alertTiers,
        viewMode: viewMode
      });
    } catch (error) {
      logger.error('GET /api/tokens/top failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/all', async (req, res) => {
    try {
      const allTokens = tokenManager.getAllTokens();

      res.json({
        tokens: allTokens.map(token => ({
          contractAddress: token.contractAddress,
          name: token.name,
          symbol: token.symbol,
          spottedAt: token.spottedAt,
          spottedMc: token.spottedMc,
          currentMc: token.currentMc,
          volume24h: token.volume24h,
          multiplier: token.peakMultiplier,
          peakMultiplier: token.peakMultiplier,
          lastUpdated: token.lastUpdated
        })),
        count: allTokens.length
      });
    } catch (error) {
      logger.error('GET /api/tokens/all failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/stats', (req, res) => {
    try {
      res.json({
        topCount: tokenManager.topTokens.length,
        fadeOutCount: tokenManager.fadeOutTokens.length,
        monitoringCount: tokenManager.trackedTokens.size,
        monitoringWindow: '2 hours',
        tier1: tokenManager.alertTiers.tier1
      });
    } catch (error) {
      logger.error('GET /api/tokens/stats failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/holder', async (req, res) => {
    try {
      const holderTokens = tokenManager.getHolderTokens();
      const holderMVP = tokenManager.getHolderMVP();

      res.json({
        tokens: holderTokens.map((token) => {
          const holderSpottedMc = token.holderSpottedMc || token.spottedMc || 1;
          const holderPeakMult = token.holderPeakMultiplier || token.peakMultiplier || 1.0;
          const currentMultiplier = holderSpottedMc > 0 ? token.currentMc / holderSpottedMc : 1.0;
          const isHolderMVP = holderMVP && token.contractAddress === holderMVP.contractAddress;

          let netPercent = 0;
          if (token.mcTenMinutesAgo !== undefined && token.mcTenMinutesAgo !== null && token.mcTenMinutesAgo > 0) {
            netPercent = ((token.currentMc - token.mcTenMinutesAgo) / token.mcTenMinutesAgo) * 100;
          }

          return {
            ...token,
            rank: token.holderRank,
            name: token.symbol && token.symbol !== 'UNKNOWN' ? token.symbol : token.name,
            spottedMc: holderSpottedMc,
            peakMultiplier: holderPeakMult,
            multiplier: currentMultiplier.toFixed(2) + 'x',
            currentMultiplier: currentMultiplier.toFixed(2) + 'x',
            peakMultiplierFormatted: holderPeakMult.toFixed(2) + 'x',
            netPercent: parseFloat(netPercent.toFixed(2)),
            isMVP: isHolderMVP
          };
        }),
        mvp: holderMVP ? {
          address: holderMVP.address,
          name: holderMVP.name,
          fullName: holderMVP.fullName,
          score: parseFloat(holderMVP.score.toFixed(2)),
          health: parseFloat(holderMVP.health.toFixed(1)),
          components: {
            multiplier: {
              raw: parseFloat(holderMVP.components.multiplier.raw.toFixed(2)),
              score: parseFloat(holderMVP.components.multiplier.score.toFixed(1)),
              weight: holderMVP.components.multiplier.weight
            },
            consistency: {
              raw: parseFloat(holderMVP.components.consistency.raw.toFixed(2)),
              score: parseFloat(holderMVP.components.consistency.score.toFixed(1)),
              weight: holderMVP.components.consistency.weight
            },
            volume: {
              raw: holderMVP.components.volume.raw,
              score: parseFloat(holderMVP.components.volume.score.toFixed(1)),
              weight: holderMVP.components.volume.weight
            },
            rank: {
              raw: holderMVP.components.rank.raw,
              score: parseFloat(holderMVP.components.rank.score.toFixed(1)),
              weight: holderMVP.components.rank.weight
            }
          },
          currentMc: holderMVP.currentMc,
          spottedMc: holderMVP.spottedMc,
          peakMc: holderMVP.peakMc,
          volume24h: holderMVP.volume24h,
          logoUrl: holderMVP.logoUrl,
          contractAddress: holderMVP.contractAddress,
          holderRank: holderMVP.holderRank,
          multiplier: parseFloat(holderMVP.multiplier.toFixed(2))
        } : null,
        holderCount: holderTokens.length,
        mode: 'holder'
      });
    } catch (error) {
      logger.error('GET /api/tokens/holder failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
