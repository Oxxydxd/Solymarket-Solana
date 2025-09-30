document.addEventListener('DOMContentLoaded', async () => {
  // --- Professional Order Book Logic (works for all markets, future-proof) ---
  let currentOrderBookOutcomeId = null;

  function renderOrderBookTabs(outcomes, selectedOutcomeId) {
    const tabs = document.getElementById('orderBookTabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    outcomes.forEach((outcome, i) => {
      const tab = document.createElement('button');
      tab.className = 'order-book-tab' + (outcome.id === selectedOutcomeId ? ' active' : '');
      tab.style.borderBottomColor = getOutcomeColor ? getOutcomeColor(outcome.id) : '#baff33';
      tab.textContent = outcome.name;
      tab.onclick = () => {
        currentOrderBookOutcomeId = outcome.id;
        renderOrderBookUI();
      };
      tabs.appendChild(tab);
    });
  }

  function renderOrderBookRows(orders, side, maxAmount) {
    return orders.map(order => {
      const width = maxAmount ? (100 * order.amount / maxAmount) : 0;
      return `
        <div class="order-book-row ${side}">
          <div class="ob-bar" style="width:${width}%;"></div>
          <span class="ob-col ob-price">${order.price ? order.price.toFixed(4) : ''}</span>
          <span class="ob-col ob-shares">${order.amount}</span>
          <span class="ob-col ob-total">${order.price && order.amount ? (order.price * order.amount).toFixed(2) : ''}</span>
        </div>
      `;
    }).join('');
  }

  function renderOrderBookUI() {
    // Use global or passed-in marketOrderBook/marketOutcomes
    const orderBook = window.marketOrderBook || [];
    const outcomes = window.marketOutcomes || [];
    const selectedId = currentOrderBookOutcomeId || (outcomes[0] && outcomes[0].id);
    renderOrderBookTabs(outcomes, selectedId);
    // Filter orders for selected outcome
    const asks = orderBook.filter(o => o.outcomeId === selectedId && o.side === 'ask').sort((a,b) => a.price-b.price);
    const bids = orderBook.filter(o => o.outcomeId === selectedId && o.side === 'bid').sort((a,b) => b.price-a.price);
    const maxAmount = Math.max(
      ...asks.map(o=>o.amount),
      ...bids.map(o=>o.amount),
      1
    );
    const asksEl = document.getElementById('orderBookAsks');
    const bidsEl = document.getElementById('orderBookBids');
    if (asksEl) asksEl.innerHTML = renderOrderBookRows(asks, 'ask', maxAmount);
    if (bidsEl) bidsEl.innerHTML = renderOrderBookRows(bids, 'bid', maxAmount);
    // Center line: show spread or mid
    let center = '';
    if (asks.length && bids.length) {
      const spread = (asks[0].price - bids[0].price).toFixed(4);
      center = `Spread: <span style='color:#baff33'>${spread}</span>`;
    } else {
      center = asks.length ? 'No bids' : bids.length ? 'No asks' : 'No orders';
    }
    const centerEl = document.getElementById('orderBookCenterLine');
    if (centerEl) centerEl.innerHTML = center;
  }

  // --- Live update hook (call this when market/orderBook/outcomes change) ---
  function updateOrderBook(orderBook, outcomes) {
    window.marketOrderBook = orderBook;
    window.marketOutcomes = outcomes;
    if (!currentOrderBookOutcomeId && outcomes && outcomes.length) {
      currentOrderBookOutcomeId = outcomes[0].id;
    }
    renderOrderBookUI();
  }

  // --- Example: Call updateOrderBook with real data when loaded ---
  // updateOrderBook(liveOrderBook, liveOutcomes);
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) {
    document.body.innerHTML = "<p>No market selected.</p>";
    return;
  }

  // Global variables
  let market;
  let wallet = null;
  let walletAdapter = null;
  let connection = null;
  let solBalance = 0;
  let rpcFallbackMode = false;
  let selectedOption = null;

  // Configuration
  const API_BASE_URL = 'https://api.solymarket.cc/api';
  const TREASURY_WALLET = '3SgkeKqYFhJy7YA2yVdaJEcZxtHqX68DesouKH4A6evm';
  const RPC_ENDPOINTS = [
    'https://mainnet.helius-rpc.com/?api-key=f2f75056-c535-4df0-84ff-d8eb55198b7c',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana'
  ];

  // Wait for Solana library
  async function waitForSolana() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 30;
      
      const check = () => {
        attempts++;
        if (typeof solanaWeb3 !== 'undefined') {
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error('Solana library failed to load'));
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }

  // Wait for Chart.js
  async function waitForChart() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 50;
      
      const check = () => {
        attempts++;
        
        if (typeof Chart !== 'undefined' && Chart.register) {
          console.log('Chart.js detected and ready');
          try {
            Chart.register(
              Chart.CategoryScale,
              Chart.LinearScale,
              Chart.PointElement,
              Chart.LineElement,
              Chart.BarElement,
              Chart.Title,
              Chart.Tooltip,
              Chart.Legend
            );
            console.log('Chart.js components registered');
            resolve(true);
          } catch (error) {
            console.warn('Failed to register Chart.js components:', error);
            resolve(false);
          }
        } else if (attempts >= maxAttempts) {
          console.warn('Chart.js not available after', maxAttempts, 'attempts');
          resolve(false);
        } else {
          setTimeout(check, 50);
        }
      };
      
      check();
    });
  }

  // Initialize Solana
  async function initializeSolana() {
    try {
      await waitForSolana();
      
      for (const endpoint of RPC_ENDPOINTS) {
        try {
          const testConnection = new solanaWeb3.Connection(endpoint, 'confirmed');
          await testConnection.getEpochInfo();
          connection = testConnection;
          console.log(`Connected to Solana via: ${endpoint}`);
          rpcFallbackMode = false;
          return true;
        } catch (error) {
          console.warn(`RPC endpoint ${endpoint} failed:`, error.message);
          continue;
        }
      }
      
      console.error('All RPC endpoints failed - using fallback mode');
      rpcFallbackMode = true;
      connection = new solanaWeb3.Connection(RPC_ENDPOINTS[0], 'confirmed');
      return true;
      
    } catch (error) {
      console.error('Failed to initialize Solana:', error);
      rpcFallbackMode = true;
      return false;
    }
  }

  // Utility functions
  function toast(msg) {
    alert(msg);
  }

  async function apiRequest(endpoint, options = {}) {
    try {
      const response = await fetch(API_BASE_URL + endpoint, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} - ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Build chart data like Polymarket - probability over time
  function buildChartData(bets, options) {
    if (!bets || bets.length === 0) {
      return { labels: [], oddsData: options.map(() => []), volumeData: [] };
    }

    // Sort bets by time
    const sorted = [...bets].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Track cumulative volume
    const optionVolumes = options.map(() => 0);
    let totalVolume = 0;

    // Chart datasets
    const oddsData = options.map(() => []); // one line per option
    const labels = [];
    const volumeData = [];

    // Add initial state (equal probability)
    const initialProb = 100 / options.length;
    labels.push('Start');
    options.forEach((opt, i) => {
      oddsData[i].push(initialProb.toFixed(1));
    });
    volumeData.push(0);

    sorted.forEach((bet, index) => {
      const t = new Date(bet.created_at);
      const idx = bet.option_id;

      optionVolumes[idx] += parseFloat(bet.amount);
      totalVolume += parseFloat(bet.amount);

      // Format time like Polymarket
      const timeLabel = t.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      labels.push(timeLabel);

      // Calculate probability for each option
      options.forEach((opt, i) => {
        const pct = totalVolume > 0 ? (optionVolumes[i] / totalVolume) * 100 : initialProb;
        oddsData[i].push(pct.toFixed(1));
      });

      // Record bet volume
      volumeData.push(parseFloat(bet.amount));
    });

    return { labels, oddsData, volumeData, optionVolumes, totalVolume };
  }

  // Render Polymarket-style probability chart
  function renderPriceChart(market) {
    const ctx = document.getElementById('priceChart');
    if (!ctx || !market.bets || market.bets.length === 0) {
      if (ctx) {
        ctx.parentElement.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #9ca3af;">
            No betting history available yet
          </div>
        `;
      }
      return;
    }

    if (window.priceChartInstance) {
      window.priceChartInstance.destroy();
    }

    const { labels, oddsData } = buildChartData(market.bets, market.options);
    const colors = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

    window.priceChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: market.options.map((opt, i) => ({
          label: opt.name,
          data: oddsData[i],
          borderColor: colors[i % colors.length],
          backgroundColor: colors[i % colors.length] + '20',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
          borderWidth: 3,
          pointHoverBackgroundColor: colors[i % colors.length],
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: {
              callback: function(value) {
                return value + '%';
              },
              color: '#9ca3af',
              font: {
                size: 12,
                family: 'Inter, system-ui, sans-serif'
              }
            },
            grid: {
              color: 'rgba(156, 163, 175, 0.1)',
              drawBorder: false
            }
          },
          x: {
            ticks: {
              color: '#9ca3af',
              font: {
                size: 11,
                family: 'Inter, system-ui, sans-serif'
              },
              maxTicksLimit: 6
            },
            grid: {
              display: false
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            titleColor: '#f9fafb',
            bodyColor: '#d1d5db',
            borderColor: 'rgba(75, 85, 99, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                return `${context.formattedValue} SOL bet`;
              }
            }
          }
        }
      }
    });
    console.log('Volume chart rendered successfully');
  }

  // Update current price display like Polymarket
  function updateCurrentPrice(market) {
    if (!market.bets || market.bets.length === 0) {
      document.getElementById('currentPrice').textContent = '50% chance';
      document.getElementById('priceChange').textContent = '';
      return;
    }

    const { optionVolumes, totalVolume } = buildChartData(market.bets, market.options);
    
    // Find the leading option (highest probability)
    let leadingIndex = 0;
    let highestProb = 0;
    
    optionVolumes.forEach((volume, index) => {
      const prob = totalVolume > 0 ? (volume / totalVolume) * 100 : 50;
      if (prob > highestProb) {
        highestProb = prob;
        leadingIndex = index;
      }
    });

    // Calculate price change (simplified - could be enhanced with time-based comparison)
    const currentProb = highestProb;
    const change = currentProb - (100 / market.options.length); // vs initial equal probability
    
    document.getElementById('currentPrice').textContent = `${currentProb.toFixed(0)}% chance`;
    
    const priceChangeEl = document.getElementById('priceChange');
    if (change > 0) {
      priceChangeEl.textContent = `+${change.toFixed(1)}% from start`;
      priceChangeEl.className = 'price-change positive';
    } else if (change < 0) {
      priceChangeEl.textContent = `${change.toFixed(1)}% from start`;
      priceChangeEl.className = 'price-change negative';
    } else {
      priceChangeEl.textContent = 'No change';
      priceChangeEl.className = 'price-change';
    }
  }

  // Wallet functions
  async function connectWallet() {
    try {
      if (!window.solana) {
        toast('Phantom wallet not detected. Please install Phantom wallet extension.');
        window.open('https://phantom.app/', '_blank');
        return;
      }

      if (window.solana.isConnected) {
        wallet = window.solana.publicKey;
        walletAdapter = window.solana;
      } else {
        const response = await window.solana.connect({ onlyIfTrusted: false });
        wallet = response.publicKey;
        walletAdapter = window.solana;
      }
      
      if (connection && !rpcFallbackMode) {
        try {
          const balance = await connection.getBalance(wallet);
          solBalance = balance / solanaWeb3.LAMPORTS_PER_SOL;
        } catch (error) {
          console.warn('Could not fetch balance:', error.message);
          rpcFallbackMode = true;
          solBalance = 0;
        }
      }
      
      updateWalletUI();
      toast('Wallet connected successfully!');
      
    } catch (error) {
      console.error('Wallet connection failed:', error);
      if (error.code === 4001 || error.message.includes('User rejected')) {
        toast('Wallet connection rejected by user');
      } else {
        toast('Failed to connect wallet. Please try again.');
      }
    }
  }

  async function disconnectWallet() {
    try {
      if (walletAdapter && walletAdapter.disconnect) {
        await walletAdapter.disconnect();
      }
    } catch (error) {
      console.error('Disconnect error:', error);
    }
    
    wallet = null;
    walletAdapter = null;
    solBalance = 0;
    updateWalletUI();
    toast('Wallet disconnected');
  }

  function updateWalletUI() {
    const walletBtn = document.getElementById('walletBtn');
    const balanceDisplay = document.getElementById('balanceDisplay');
    const solBalanceEl = document.getElementById('solBalance');
    
    if (wallet) {
      const address = wallet.toString();
      walletBtn.textContent = `${address.slice(0, 4)}...${address.slice(-4)}`;
      walletBtn.classList.add('connected');
      
      if (!rpcFallbackMode) {
        balanceDisplay.style.display = 'flex';
        solBalanceEl.textContent = solBalance.toFixed(3);
      } else {
        balanceDisplay.style.display = 'none';
      }
    } else {
      walletBtn.textContent = 'Connect Wallet';
      walletBtn.classList.remove('connected');
      balanceDisplay.style.display = 'none';
    }
  }

  // Market loading
  async function loadMarket() {
    try {
      const response = await apiRequest(`/markets/${id}`);
      market = response.market;
      console.log("Market data:", market);
      document.getElementById('marketTitle').textContent = market.title;
      document.getElementById('marketCategory').textContent = market.category;

      // Calculate volumes
      const optionVolumes = {};
      market.options.forEach((opt, idx) => optionVolumes[idx] = 0);
      if (market.bets && market.bets.length > 0) {
        market.bets.forEach(bet => {
          optionVolumes[bet.option_id] += parseFloat(bet.amount);
        });
      }
      const totalVolume = Object.values(optionVolumes).reduce((a, b) => a + b, 0);
      document.getElementById('marketVolume').textContent = `${totalVolume.toFixed(3)} SOL`;

      // Update current price display
      updateCurrentPrice(market);
      // Render outcomes
      renderOutcomes(optionVolumes, totalVolume);
      // Render betting options
      renderBettingOptions();
      // Update betting interface
      updateBettingInterface();
      // Render betting history
      renderBettingHistory();
      // Render Polymarket-style charts
      renderPriceChart(market);
      renderVolumeChart(market);


      // --- ORDER BOOK: fetch real data from backend ---
      try {
        const obRes = await fetch(API_BASE_URL + `/orderbook/${market.id}`);
        if (obRes.ok) {
          const obData = await obRes.json();
          updateOrderBook(obData.orderBook || [], market.options);
        } else {
          updateOrderBook([], market.options);
        }
      } catch (err) {
        updateOrderBook([], market.options);
      }

    } catch (error) {
      console.error('Failed to load market:', error);
      toast('Failed to load market data: ' + error.message);
    }
  }

  function renderOutcomes(optionVolumes, totalVolume) {
    const outcomesEl = document.getElementById('outcomes');
    outcomesEl.innerHTML = '';
    
    market.options.forEach((opt, idx) => {
      const volume = optionVolumes[idx] || 0;
      const pct = totalVolume > 0 ? ((volume / totalVolume) * 100).toFixed(1) : 0;
      
      const outcomeCard = document.createElement('div');
      outcomeCard.className = 'outcome-card';
      
      const percentageDiv = document.createElement('div');
      percentageDiv.className = 'outcome-percentage';
      percentageDiv.textContent = pct + '%';
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'outcome-name';
      nameDiv.textContent = opt.name;
      
      const volumeDiv = document.createElement('div');
      volumeDiv.className = 'outcome-volume';
      volumeDiv.textContent = volume.toFixed(3) + ' SOL';
      
      outcomeCard.appendChild(percentageDiv);
      outcomeCard.appendChild(nameDiv);
      outcomeCard.appendChild(volumeDiv);
      outcomesEl.appendChild(outcomeCard);
    });
  }

  function renderBettingOptions() {
    if (!market || !market.options) return;
    
    const container = document.getElementById('bettingOptions');
    container.innerHTML = '';
    
    // Calculate volumes
    const optionVolumes = {};
    market.options.forEach((opt, idx) => optionVolumes[idx] = 0);
    
    if (market.bets && market.bets.length > 0) {
      market.bets.forEach(bet => {
        optionVolumes[bet.option_id] += parseFloat(bet.amount);
      });
    }
    
    const totalVolume = Object.values(optionVolumes).reduce((a, b) => a + b, 0);
    
    market.options.forEach((option, index) => {
      // Always use admin-set odds if available, otherwise show warning placeholder
      let odds = null;
      if (market.metadata && Array.isArray(market.metadata.admin_odds) && market.metadata.admin_odds[index] !== undefined && !isNaN(parseFloat(market.metadata.admin_odds[index]))) {
        odds = parseFloat(market.metadata.admin_odds[index]);
      }
      const isSelected = selectedOption === index;
      const volume = optionVolumes[index] || 0;
      const percentage = totalVolume > 0 ? ((volume / totalVolume) * 100).toFixed(1) : (100 / market.options.length).toFixed(1);
      
      // Create betting option
      const optionDiv = document.createElement('div');
      optionDiv.className = `betting-option ${isSelected ? 'selected' : ''}`;
      optionDiv.onclick = () => selectBettingOption(index);
      
      // Content container
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 8px;';
      
      // Image
      const img = document.createElement('img');
      img.className = 'option-image';
      img.alt = option.name;
      
      if (option.image && option.image.trim() !== '') {
        img.src = option.image;
        img.onerror = function() {
          this.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjAiIGZpbGw9IiM0Yjc4OTAiLz4KPHRleHQgeD0iMjQiIHk9IjMwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1zaXplPSIxOCIgZm9udC1mYW1pbHk9IkFyaWFsIj4/PC90ZXh0Pgo8L3N2Zz4=';
        };
      } else {
        img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjAiIGZpbGw9IiM0Yjc4OTAiLz4KPHRleHQgeD0iMjQiIHk9IjMwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1zaXplPSIxOCIgZm9udC1mYW1pbHk9IkFyaWFsIj4/PC90ZXh0Pgo8L3N2Zz4=';
      }
      
      // Text container
      const textDiv = document.createElement('div');
      textDiv.style.flex = '1';
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'option-name';
      nameDiv.textContent = option.name;
      
      const percentageDiv = document.createElement('div');
      percentageDiv.style.cssText = 'color: #10b981; font-weight: 700; font-size: 18px;';
      percentageDiv.textContent = percentage + '%';
      
      // Odds display
      const oddsDiv = document.createElement('div');
      oddsDiv.className = 'option-odds';
      oddsDiv.style.textAlign = 'center';
      if (odds !== null) {
        oddsDiv.innerHTML = `<div style='color:#f59e0b;font-size:0.98em;font-weight:600;margin-top:2px;'>x${odds.toFixed(2)}</div><div style='color:#9ca3af;font-size:0.95em;'>${volume.toFixed(3)} SOL</div>`;
      } else {
        oddsDiv.innerHTML = `<div style='color:#ef4444;font-size:0.98em;font-weight:600;margin-top:2px;'>Set odds in admin panel</div><div style='color:#9ca3af;font-size:0.95em;'>${volume.toFixed(3)} SOL</div>`;
      }
      
      // Assemble
      textDiv.appendChild(nameDiv);
      textDiv.appendChild(percentageDiv);
      contentDiv.appendChild(img);
      contentDiv.appendChild(textDiv);
      optionDiv.appendChild(contentDiv);
      optionDiv.appendChild(oddsDiv);
      container.appendChild(optionDiv);
    });
  }

  function renderBettingHistory() {
    if (!market.bets || market.bets.length === 0) {
      return;
    }

    const outcomesSection = document.getElementById('outcomes').parentElement;
    
    // Remove existing
    const existingHistory = document.getElementById('bettingHistorySection');
    if (existingHistory) {
      existingHistory.remove();
    }

    const historySection = document.createElement('div');
    historySection.id = 'bettingHistorySection';
    historySection.className = 'section-card';
    historySection.style.marginTop = '24px';
    
    // Title
    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = `Recent Bets (${market.bets.length} total)`;
    
    // Grid
    const gridContainer = document.createElement('div');
    gridContainer.className = 'betting-history-grid';
    
    // Create bet cards
    const recentBets = market.bets.slice(-10).reverse();
    recentBets.forEach(bet => {
      const option = market.options[bet.option_id];
      const timeAgo = new Date(bet.created_at).toLocaleString();
      
      const betCard = document.createElement('div');
      betCard.className = 'bet-history-card';
      
      // Option info
      const optionInfo = document.createElement('div');
      optionInfo.className = 'bet-option-info';
      
      const img = document.createElement('img');
      img.alt = option?.name || 'Option';
      img.style.cssText = 'width: 32px; height: 32px; border-radius: 50%; object-fit: cover;';
      
      if (option?.image && option.image.trim() !== '') {
        img.src = option.image;
        img.onerror = function() {
          this.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTUiIGZpbGw9IiM0Yjc4OTAiLz4KPHRleHQgeD0iMTYiIHk9IjIwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1zaXplPSIxNCIgZm9udC1mYW1pbHk9IkFyaWFsIj4/PC90ZXh0Pgo8L3N2Zz4=';
        };
      } else {
        img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTUiIGZpbGw9IiM0Yjc4OTAiLz4KPHRleHQgeD0iMTYiIHk9IjIwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1zaXplPSIxNCIgZm9udC1mYW1pbHk9IkFyaWFsIj4/PC90ZXh0Pgo8L3N2Zz4=';
      }
      
      const textContainer = document.createElement('div');
      
      const optionName = document.createElement('div');
      optionName.style.cssText = 'color: #f9fafb; font-weight: 600;';
      optionName.textContent = option?.name || 'Unknown Option';
      
      const timeDiv = document.createElement('div');
      timeDiv.style.cssText = 'color: #9ca3af; font-size: 12px;';
      timeDiv.textContent = timeAgo;
      
      textContainer.appendChild(optionName);
      textContainer.appendChild(timeDiv);
      optionInfo.appendChild(img);
      optionInfo.appendChild(textContainer);
      
      // Amount info
      const amountInfo = document.createElement('div');
      amountInfo.className = 'bet-amount-info';
      
      const amountDiv = document.createElement('div');
      amountDiv.style.cssText = 'color: #10b981; font-weight: 700; font-size: 16px;';
      amountDiv.textContent = `${parseFloat(bet.amount).toFixed(3)} SOL`;
      
      const addressDiv = document.createElement('div');
      addressDiv.style.cssText = 'color: #9ca3af; font-size: 12px;';
      addressDiv.textContent = `${bet.bettor_address.slice(0, 6)}...${bet.bettor_address.slice(-4)}`;
      
      amountInfo.appendChild(amountDiv);
      amountInfo.appendChild(addressDiv);
      
      if (bet.transaction_signature) {
        const txLink = document.createElement('a');
        txLink.href = `https://explorer.solana.com/tx/${bet.transaction_signature}?cluster=mainnet-beta`;
        txLink.target = '_blank';
        txLink.style.cssText = 'color: #10b981; font-size: 11px; text-decoration: none;';
        txLink.textContent = 'View TX ↗';
        amountInfo.appendChild(txLink);
      }
      
      betCard.appendChild(optionInfo);
      betCard.appendChild(amountInfo);
      gridContainer.appendChild(betCard);
    });
    
    historySection.appendChild(title);
    historySection.appendChild(gridContainer);

    // Add CSS once
    if (!document.getElementById('betting-history-styles')) {
      const style = document.createElement('style');
      style.id = 'betting-history-styles';
      style.textContent = `
        .betting-history-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .bet-history-card {
          background: rgba(31, 41, 55, 0.6);
          border: 1px solid rgba(75, 85, 99, 0.3);
          border-radius: 8px;
          padding: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .bet-option-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .bet-amount-info {
          text-align: right;
        }
      `;
      document.head.appendChild(style);
    }

    outcomesSection.parentNode.insertBefore(historySection, outcomesSection.nextSibling);
  }

  function selectBettingOption(index) {
    selectedOption = index;
    renderBettingOptions();
    updateBettingInterface();
    calculatePotentialReturn();
  }

  function updateBettingInterface() {
    const bettingWarning = document.getElementById('bettingWarning');
    const placeBetBtn = document.getElementById('placeBetBtn');
    const betAmountInput = document.getElementById('betAmount');
    
    if (!wallet) {
      bettingWarning.style.display = 'block';
      bettingWarning.textContent = 'Connect your wallet to place bets on this market';
      placeBetBtn.disabled = true;
      betAmountInput.disabled = true;
      return;
    }
    
    if (!market || market.status !== 'active') {
      bettingWarning.style.display = 'block';
      bettingWarning.textContent = 'This market is not available for betting';
      placeBetBtn.disabled = true;
      betAmountInput.disabled = true;
      return;
    }
    
    // Disable betting if odds are not set for the selected option
    let oddsSet = false;
    if (market && Array.isArray(market.metadata?.admin_odds) && selectedOption !== null) {
      const o = market.metadata.admin_odds[selectedOption];
      oddsSet = o !== undefined && !isNaN(parseFloat(o));
    }
    if (!oddsSet) {
      bettingWarning.style.display = 'block';
      bettingWarning.textContent = 'Odds not set for this option. Please wait for admin.';
      placeBetBtn.disabled = true;
      betAmountInput.disabled = true;
      return;
    }
    bettingWarning.style.display = 'none';
    placeBetBtn.disabled = selectedOption === null;
    betAmountInput.disabled = false;
  }

  function calculatePotentialReturn() {
    const betAmount = parseFloat(document.getElementById('betAmount').value || 0);
    const returnDisplay = document.getElementById('potentialReturn');
    
    if (!betAmount || selectedOption === null || !market) {
      returnDisplay.textContent = '0.00 SOL';
      return;
    }
    
    // Always parse odds as number, fallback to option.odds, then 2.0
    let odds = null;
    if (market.metadata && Array.isArray(market.metadata.admin_odds) && market.metadata.admin_odds[selectedOption] !== undefined && !isNaN(parseFloat(market.metadata.admin_odds[selectedOption]))) {
      odds = parseFloat(market.metadata.admin_odds[selectedOption]);
    }
    if (odds !== null) {
      const potentialReturn = betAmount * odds;
      returnDisplay.textContent = `${potentialReturn.toFixed(3)} SOL`;
    } else {
      returnDisplay.textContent = 'Set odds in admin panel to calculate';
    }
  }

  function setBetAmount(amount) {
    document.getElementById('betAmount').value = amount;
    calculatePotentialReturn();
  }

  // Betting functionality
  async function placeBet(optionId, amount) {
    if (!wallet || !walletAdapter) {
      toast('Please connect your wallet first');
      return;
    }
    
    if (!market || market.status !== 'active') {
      toast('This market is not available for betting');
      return;
    }
    
    try {
      toast('Processing bet on Solana mainnet...');
      
      const transaction = new solanaWeb3.Transaction();
      
      const transferInstruction = solanaWeb3.SystemProgram.transfer({
        fromPubkey: wallet,
        toPubkey: new solanaWeb3.PublicKey(TREASURY_WALLET),
        lamports: Math.floor(amount * solanaWeb3.LAMPORTS_PER_SOL)
      });
      
      transaction.add(transferInstruction);
      
      try {
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
      } catch (error) {
        console.warn('Could not get recent blockhash:', error.message);
      }
      
      transaction.feePayer = wallet;
      
      const signedTransaction = await walletAdapter.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());
      
      try {
        await connection.confirmTransaction(signature);
        console.log('Bet transaction confirmed:', signature);
      } catch (error) {
        console.warn('Could not confirm transaction:', error.message);
      }
      
      // Record bet in database
      await apiRequest('/bets', {
        method: 'POST',
        body: JSON.stringify({
          marketId: market.id,
          bettorAddress: wallet.toString(),
          optionId: optionId,
          amount: amount,
          transactionSignature: signature
        })
      });
      
      if (!rpcFallbackMode) {
        try {
          const balance = await connection.getBalance(wallet);
          solBalance = balance / solanaWeb3.LAMPORTS_PER_SOL;
          updateWalletUI();
        } catch (error) {
          console.warn('Could not update balance:', error.message);
        }
      }
      
      toast('Bet placed successfully!');
      await loadMarket();
      
    } catch (error) {
      console.error('Bet placement failed:', error);
      if (error.message.includes('User rejected')) {
        toast('Transaction cancelled by user');
      } else {
        toast('Failed to place bet: ' + error.message);
      }
    }
  }

  async function handlePlaceBet() {
    if (!wallet || selectedOption === null || !market) {
      toast('Please connect wallet and select an option');
      return;
    }
    
    const betAmount = parseFloat(document.getElementById('betAmount').value || 0);
    if (betAmount <= 0) {
      toast('Please enter a valid bet amount');
      return;
    }
    
    if (!rpcFallbackMode && betAmount > solBalance) {
      toast('Insufficient balance');
      return;
    }
    
    await placeBet(selectedOption, betAmount);
    
    // Reset form
    document.getElementById('betAmount').value = '';
    selectedOption = null;
    renderBettingOptions();
    updateBettingInterface();
  }

  // Initialize everything
  async function initialize() {
    console.log('Initializing market detail page...');
    
    // Wait for Chart.js
    console.log('Waiting for Chart.js library...');
    const chartAvailable = await waitForChart();
    
    if (chartAvailable) {
      console.log('Charts enabled - Chart.js is ready');
    } else {
      console.log('Charts disabled - Chart.js unavailable');
    }
    
    // Initialize Solana
    const solanaReady = await initializeSolana();
    if (!solanaReady) {
      console.warn('Solana initialization failed');
    }
    
    // Set up wallet events
    const walletBtn = document.getElementById('walletBtn');
    if (walletBtn) {
      walletBtn.addEventListener('click', () => {
        if (wallet) {
          disconnectWallet();
        } else {
          connectWallet();
        }
      });
    }
    
    // Set up betting events
    const placeBetBtn = document.getElementById('placeBetBtn');
    if (placeBetBtn) {
      placeBetBtn.addEventListener('click', handlePlaceBet);
    }
    
    const betAmountInput = document.getElementById('betAmount');
    if (betAmountInput) {
      betAmountInput.addEventListener('input', calculatePotentialReturn);
    }
    
    // Load market data
    await loadMarket();
    
    // Auto-refresh every 30 seconds
    setInterval(async () => {
      try {
        await loadMarket();
      } catch (error) {
        console.warn('Auto-refresh failed:', error.message);
      }
    }, 30000);
    
    console.log('Market detail page initialized successfully');
  }

  // Start initialization
  await initialize();

  // Make functions available globally
  window.selectBettingOption = selectBettingOption;
  window.setBetAmount = setBetAmount;
  window.handlePlaceBet = handlePlaceBet;
  // Initialize everything
  async function initialize() {
    console.log('Initializing market detail page...');

    // Wait for Chart.js
    console.log('Waiting for Chart.js library...');
    const chartAvailable = await waitForChart();
    if (chartAvailable) {
      console.log('Charts enabled - Chart.js is ready');
    } else {
      console.log('Charts disabled - Chart.js unavailable');
    }

    // Initialize Solana
    const solanaReady = await initializeSolana();
    if (!solanaReady) {
      console.warn('Solana initialization failed');
    }

    // Set up wallet events
    const walletBtn = document.getElementById('walletBtn');
    if (walletBtn) {
      walletBtn.addEventListener('click', () => {
        if (wallet) {
          disconnectWallet();
        } else {
          connectWallet();
        }
      });
    }

    // Set up betting events
    const placeBetBtn = document.getElementById('placeBetBtn');
    if (placeBetBtn) {
      placeBetBtn.addEventListener('click', handlePlaceBet);
    }

    const betAmountInput = document.getElementById('betAmount');
    if (betAmountInput) {
      betAmountInput.addEventListener('input', calculatePotentialReturn);
    }

    // Load market data
    await loadMarket();

    // Auto-refresh every 30 seconds
    setInterval(async () => {
      try {
        await loadMarket();
      } catch (error) {
        console.warn('Auto-refresh failed:', error.message);
      }
    }, 30000);

    console.log('Market detail page initialized successfully');
  }

  // Start initialization
  await initialize();

  // Make functions available globally
  window.selectBettingOption = selectBettingOption;
  window.setBetAmount = setBetAmount;
  window.handlePlaceBet = handlePlaceBet;
});

