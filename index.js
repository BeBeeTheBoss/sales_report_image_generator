const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const config of iface || []) {
            if (config.family === 'IPv4' && !config.internal) {
                return config.address;
            }
        }
    }
    return '127.0.0.1';
}

app.use(express.json({ limit: '50mb' }));

// Static Folder for Reports and UI
const uploadsDir = path.join(__dirname, 'public/reports');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/reports', express.static(uploadsDir));

// --- SIMPLE TESTING UI ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sales Report Tester</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-slate-100 p-10">
            <div class="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-md">
                <h1 class="text-2xl font-bold mb-4 text-slate-800">Sales Report Image Generator</h1>
                <p class="text-slate-600 mb-6 text-sm">JSON data များကို အောက်တွင် ထည့်သွင်းပြီး Test လုပ်နိုင်ပါသည်။</p>
                
                <textarea id="jsonInput" class="w-full h-64 p-4 border rounded-lg font-mono text-xs mb-4" placeholder="Paste your JSON array here..."></textarea>
                
                <button onclick="generateReport()" id="btn" class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
                    Generate Report Image
                </button>

                <div id="result" class="mt-8 hidden">
                    <h2 class="text-lg font-semibold mb-2">Result:</h2>
                    <a id="downloadLink" href="#" target="_blank" class="text-blue-600 underline text-sm mb-4 block">Open Image in New Tab</a>
                    <img id="reportImg" class="border shadow-lg w-full rounded" src="" />
                </div>
            </div>

            <script>
                async function generateReport() {
                    const btn = document.getElementById('btn');
                    const resultDiv = document.getElementById('result');
                    const input = document.getElementById('jsonInput').value;
                    
                    try {
                        const jsonData = JSON.parse(input);
                        btn.disabled = true;
                        btn.innerText = 'Generating...';

                        const response = await fetch('/generate-report-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(jsonData)
                        });

                        const data = await response.json();
                        const isSuccess = response.ok && (data.status === 'success' || !!data.imageUrl);
                        if (isSuccess) {
                            document.getElementById('reportImg').src = data.imageUrl;
                            document.getElementById('downloadLink').href = data.imageUrl;
                            resultDiv.classList.remove('hidden');
                        } else {
                            alert('Error: ' + (data.message || 'Failed to generate report image.'));
                        }
                    } catch (e) {
                        alert('Invalid JSON format!');
                    } finally {
                        btn.disabled = false;
                        btn.innerText = 'Generate Report Image';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// --- API ENDPOINT ---
app.post('/generate-report-image', async (req, res) => {
    try {
        const rawData = req.body;

        if (!Array.isArray(rawData)) {
            throw new Error("Input must be an array of objects.");
        }

        const branchesSet = new Set();
        const categoriesSet = new Set();
        let reportPeriod = "Sales Report";
        let reportType = "Sales";
        let executeTime = new Date().toLocaleString();

        rawData.forEach(item => {
            if (item.branch_name) branchesSet.add(item.branch_name);
            if (item.product_category_name) categoriesSet.add(item.product_category_name);
            if (item.dtype) {
                reportPeriod = item.dtype;
                const dtypePrefix = String(item.dtype).split(':')[0].trim().toLowerCase();
                if (dtypePrefix === 'daily') reportType = 'Daily';
                if (dtypePrefix === 'monthly') reportType = 'Monthly';
            }
        });

        const sortedBranches = Array.from(branchesSet).sort();
        const sortedCategories = Array.from(categoriesSet).sort();

        // Data processing for Sale Amount (converted to Lakh)
        const matrix = sortedCategories.map(cat => {
            return sortedBranches.map(br => {
                const found = rawData.find(d => d.product_category_name === cat && d.branch_name === br);
                return found ? (parseFloat(found.saleamnt) / 100000) : 0;
            });
        });

        // Calculate Invoices per Branch (Summing up billno values)
        const branchInvoices = sortedBranches.map(br => {
            const branchData = rawData.filter(d => d.branch_name === br);
            // logic: branch ရဲ့ billno အားလုံးကိုပေါင်းမည် (JSON ထဲက key က billno ဖြစ်ပါသည်)
            const totalBillSum = branchData.reduce((sum, item) => {
                const bNo = parseFloat(item.billno);
                return sum + (isNaN(bNo) ? 0 : bNo);
            }, 0);
            return totalBillSum;
        });

        const cleanName = (name) => name.includes('-/-') ? name.split('-/-')[1] : name;

        const htmlContent = `
            <!DOCTYPE html>
            <html>
                <head>
                    <script src="https://cdn.tailwindcss.com"></script>
                    <style>
                        body {
                            font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
                            padding: 20px;
                            background: white;
                            width: fit-content;
                            -webkit-font-smoothing: antialiased;
                            text-rendering: geometricPrecision;
                        }
                        .header-text { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
                        .sub-header { font-size: 12px; margin-bottom: 10px; }
                        table { border-collapse: collapse; border: 1px solid #333; font-size: 11px; }
                        th, td { border: 1px solid #999; padding: 4px 8px; text-align: right; }
                        th { background: #e0f2fe; color: #000; font-weight: bold; text-align: center; }
                        .cat-header { text-align: center; background: #a5f3fc; font-weight: 700; width: 260px; min-width: 260px; }
                        .cat-column { text-align: left; background: #eff6ff; font-weight: 600; width: 260px; min-width: 260px; }
                        .total-row { background: #bfdbfe; font-weight: bold; }
                        .invoice-row { background: #cffafe; font-weight: bold; }
                        .avg-row { background: #a5f3fc; font-weight: bold; }
                        .branch-header { background: #eff6ff; width: 90px; min-width: 90px; }
                        .branch-cell { width: 90px; min-width: 90px; }
                        .total-branch-header { background: #bfdbfe; width: 90px; min-width: 90px; }
                        .total-branch-cell { background: #bfdbfe; font-weight: bold; }
                        .total-label { background: #bfdbfe !important; }
                        .invoice-label { background: #cffafe !important; }
                        .avg-label { background: #a5f3fc !important; }
                    </style>
                </head>
                <body>
                    <div class="mb-4">
                        <div class="header-text uppercase">PRO 1 GLOBAL COMPANY LIMITED</div>
                        <div class="header-text">${reportType} Sales Report By Branch</div>
                        <div class="sub-header text-gray-600">Updated on ${executeTime}</div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th rowspan="2" class="cat-header">Product Category</th>
                                <th colspan="${sortedBranches.length + 1}" class="text-left px-2">${reportPeriod}</th>
                            </tr>
                            <tr>
                                ${sortedBranches.map(br => `<th class="branch-header">${cleanName(br)}</th>`).join('')}
                                <th class="total-branch-header">Total of Branch</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedCategories.map((cat, i) => {
                                const row = matrix[i];
                                const rowTotal = row.reduce((a, b) => a + b, 0);
                                return `
                                    <tr>
                                        <td class="cat-column">${cat}</td>
                                        ${row.map(val => `<td class="branch-cell">${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`).join('')}
                                        <td class="total-branch-cell">${rowTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td class="cat-column total-label" style="text-align:center">Total (Lakh)</td>
                                ${sortedBranches.map((_, brIdx) => {
                                    const colTotal = matrix.reduce((sum, row) => sum + row[brIdx], 0);
                                    return `<td class="branch-cell">${colTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
                                }).join('')}
                                <td>${matrix.flat().reduce((a, b) => a + b, 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            </tr>
                            <tr class="invoice-row">
                                <td class="cat-column invoice-label" style="text-align:center">No. of Invoice/Day</td>
                                ${branchInvoices.map(inv => `<td class="branch-cell">${inv.toLocaleString()}</td>`).join('')}
                                <td>${branchInvoices.reduce((a, b) => a + b, 0).toLocaleString()}</td>
                            </tr>
                            <tr class="avg-row">
                                <td class="cat-column avg-label" style="text-align:center">Avg. Kyat/Invoice(Lakh)</td>
                                ${sortedBranches.map((_, brIdx) => {
                                    const colTotal = matrix.reduce((sum, row) => sum + row[brIdx], 0);
                                    const invCount = branchInvoices[brIdx];
                                    // formula: total lahks / no of invoice
                                    const avg = invCount > 0 ? (colTotal / invCount) : 0;
                                    return `<td class="branch-cell">${avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
                                }).join('')}
                                ${(() => {
                                    const grandTotal = matrix.flat().reduce((a, b) => a + b, 0);
                                    const totalInvoices = branchInvoices.reduce((a, b) => a + b, 0);
                                    const grandAvg = totalInvoices > 0 ? (grandTotal / totalInvoices) : 0;
                                    return `<td>${grandAvg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
                                })()}
                            </tr>
                        </tfoot>
                    </table>
                </body>
            </html>
        `;

        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--font-render-hinting=medium', '--force-color-profile=srgb']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 2400, height: 1800, deviceScaleFactor: 4 });
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.evaluate(async () => {
            if (document.fonts && document.fonts.ready) {
                await document.fonts.ready;
            }
        });
        
        const element = await page.$('body');
        const fileName = `report_${Date.now()}.png`;
        const filePath = path.join(uploadsDir, fileName);
        
        await element.screenshot({ path: filePath });
        await browser.close();

        const imageUrl = `${req.protocol}://${req.get('host')}/reports/${fileName}`;
        res.json({ imageUrl });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(PORT, HOST, () => {
    const localIp = getLocalIp();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Network access: http://${localIp}:${PORT}`);
});
