const convertedTag = 'UACC_converted';
const hasEventsTag = 'UACC_hasEvents';
const ignoredElements = {
    'script': true,
    'rect': true,
    'svg': true
};

/**
 * Hint for future developers:
 * DO NOT DO WHAT THESE WEBSITES DO
 * @type {{"taobao.com": {delay: number}}}
 */
const shittyWebsites = {
    'taobao.com': {
        delay: 3000,
    }
};

let mouseIsOver = null;

class UACCContent {
    constructor() {
        this.engine = new Engine();
        this.loader = this.engine.loadSettings();
    }

    hasChildrenBeyond(element, limit, depth = 0) {
        if (!element || !element.children) return false;
        const children = element.children;

        if (limit <= depth)
            return children.length > 0;

        for (let i = 0; i < children.length; i++)
            if (this.hasChildrenBeyond(children[i], limit, depth + 1))
                return true;

        return false;
    }

    childrenHasCurrency(element) {
        for (let i = 0; i < element.children.length; i++)
            if (this.engine.currencyDetector.contains(element.children[i]))
                return true;
        return false;
    }

    convertElements(start) {
        const queue = [start];
        const detector = this.engine.currencyDetector;

        while (queue.length > 0) {
            const curr = queue.pop();

            if (ignoredElements[curr.tagName])
                continue;

            if (this.hasChildrenBeyond(curr, 3)) {
                for (let i = 0; i < curr.children.length; i++)
                    queue.push(curr.children[i]);
                continue;
            }

            if (!detector.contains(curr)) {
                continue;
            }

            if (detector.contains(curr, true)) {
                if (!curr.children || (curr.children.length === 1 && curr.innerText !== curr.children[0].innerText)) {
                    this.engine.elementTransformer.transform(curr, true);
                    continue;
                }
            }

            if (this.childrenHasCurrency(curr)) {
                for (let i = 0; i < curr.children.length; i++)
                    queue.push(curr.children[i]);
                continue;
            }

            this.engine.elementTransformer.transform(curr);
        }
    }
}

Timer.start('Loading settings');
const runner = new UACCContent();

/**
 * @param callback
 * @param data
 * @return {true|data}
 */
const handleResponding = (callback, data) => Browser.isFirefox() ? data : !callback(data) || true;

chrome.runtime.onMessage.addListener(
    async function (data, sender, senderResponse) {
        const transformer = runner.engine.elementTransformer;
        switch (data.method) {
            case 'contextMenu':
                const text = data.text;
                if (!text) return handleResponding(senderResponse);
                const result = runner.engine.currencyDetector.findAll(text);
                if (result.length === 0) return handleResponding(senderResponse);

                const settings = await Browser.load(['popupCurrencies', 'popupAmounts']);
                settings['popupCurrencies'] = settings['popupCurrencies'] || [];
                settings['popupAmounts'] = settings['popupAmounts'] || [];

                result.forEach(r => {
                    r.numbers.forEach(number => {
                        settings['popupCurrencies'].push(r.currency);
                        settings['popupAmounts'].push(number);
                    });
                });

                await Browser.save(settings);
                await Browser.messageBackground({method: 'openPopup'});
                break;
            case 'getLocalization':
                return handleResponding(senderResponse, runner.engine.currencyDetector.currencies[data.symbol]);
            case 'setLocalization':
                const to = data.to;
                if (!(/^[A-Z]{3}$/.test(to)))
                    return handleResponding(senderResponse);
                runner.engine.localization.site.setOverrideable(true);
                runner.engine.localization.site.setDefaultLocalization(to);
                runner.engine.currencyDetector.updateLocalizationCurrencies();
                await runner.engine.saveSiteSpecificSettings();
                transformer.updateAll();
                return handleResponding(senderResponse);
            case 'convertAll':
                transformer.setAll(data.converted);
                return handleResponding(senderResponse);
            case 'conversionCount':
                return handleResponding(senderResponse, transformer.conversions.length);
            case 'getUrl':
                return handleResponding(senderResponse, Browser.hostname);
        }
    }
);

runner.loader.finally(async () => {
    const shittySite = shittyWebsites[Browser.absoluteHostname()];
    if (shittySite)
        await Utils.wait(shittySite.delay);

    Timer.log('Loading settings');
    const engine = runner.engine;

    if (engine.blacklist.isEnabled && engine.blacklist.isBlacklisted(window.location.href))
        return;

    if (engine.whitelist.isEnabled && !engine.whitelist.isBlacklisted(window.location.href))
        return;

    Timer.start('Localization');
    const replacements = engine.currencyDetector.localize(Browser.getHost(), document.body.innerText);
    Timer.log('Localization');

    if (replacements.length > 0 && engine.showNonDefaultCurrencyAlert) {
        // Alert user about replacements
        const content = replacements.map(e =>
            `<span class="line">${e.detected} is detected for ${e.symbol}, your default is ${e.default}</span>`
        ).join('');

        const bodyColor = window.getComputedStyle(document.body, null).getPropertyValue('background-color');
        const colors = bodyColor.match(/\d+/g).map(e => Number(e)).map(e => e * 0.85);
        const backgroundColor = colors.length === 3
            ? 'rgb(' + colors.join(',') + ')'
            : 'rgba(' + colors.map(e => Math.max(e, .5)).join(',') + ')';
        const textColor = (colors.slice(0, 3).sum() / 3) >= 128 ? 'black' : 'white';

        const html = `<div class="alertWrapper" style="background-color:${backgroundColor}; color: ${textColor};">
    <span class="line" style="font-size: 10px; margin-bottom: 0; padding-bottom: 0">Universal Automatic Currency Converter</span>
    <h2 class="line" style="margin-top: 0; padding-top: 0">${Browser.hostname}</h2>
    <div class="line">${content}</div>
    <p class="line" style="font-size:12px;">You can always change site specific localization in the mini-converter popup</p>
    <div class="saveLocalizationButton" id="uacc-switch">Use detected</div>
    <div class="saveAndDismissLocalizationButton" id="uacc-save">Save site localization and dont ask again</div>
    <div class="dismissLocalizationButton" id="uacc-dismiss">Dismiss alert</div>
    <p class="line" style="font-size:12px;">This alert self destructs in <span id="uacc-countdown">60</span> seconds</p>
</div>`;
        const element = Utils.parseHtml(html);
        document.body.append(element);
        document.getElementById('uacc-dismiss').addEventListener('click', async () => {
            engine.localization.site.setOverrideable(true);
            await engine.saveSiteSpecificSettings();
            element.remove();
        });
        document.getElementById('uacc-save').addEventListener('click', async () => {
            engine.localization.site.setOverrideable(false);
            await engine.saveSiteSpecificSettings();
            element.remove();
        });
        const detected = document.getElementById('uacc-switch');
        detected.addEventListener('click', async () => {
            if (detected.className === 'revertLocalizationButton') {
                replacements.forEach(e => engine.localization.site.setDefaultLocalization(e.default));
                detected.className = 'saveLocalizationButton';
                detected.innerText = 'Use detected';
            } else {
                replacements.forEach(e => engine.localization.site.setDefaultLocalization(e.detected));
                detected.className = 'revertLocalizationButton';
                detected.innerText = 'Use my defaults';
            }
            engine.localization.site.setOverrideable(true);
            await engine.saveSiteSpecificSettings();
            engine.currencyDetector.updateLocalizationCurrencies();
            engine.elementTransformer.updateAll();
        });
        document.body.append(element);

        const expire = Date.now() + 60000;
        const countdown = document.getElementById('uacc-countdown');
        const timer = setInterval(() => {
            const now = Date.now();
            if (now > expire) {
                element.remove();
                clearInterval(timer);
            }
            countdown.innerText = Math.round((expire - now) / 1000) + '';
        }, 1000);

        detected.click();
    }

    if (engine.automaticPageConversion) {
        Timer.start('Converting page');
        runner.convertElements(document.body);
        Timer.log('Converting page');

        Browser.messagePopup({
            method: 'conversionCount',
            count: runner.conversionCount
        }).finally();

        const observer = new MutationObserver(function (mutations) {
            for (let i = 0; i < mutations.length; i++)
                for (let j = 0; j < mutations[i].addedNodes.length; j++) {
                    const parent = mutations[i].addedNodes[j].parentElement;
                    if (parent && parent.hasAttribute(convertedTag))
                        continue;
                    runner.convertElements(mutations[i].addedNodes[j]);
                }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    window.addEventListener("keyup", e => {
        // Secure element in case it changes between check and execution
        if (e.key !== engine.conversionShortcut)
            return;

        const securedOver = mouseIsOver;
        if (securedOver)
            return securedOver.UACCChanger();

        let parent;
        if (!(parent = window.getSelection()))
            return;

        if (!(parent = parent.anchorNode))
            return;
        if (!(parent = parent.parentElement))
            return;
        if (!(parent = parent.parentElement))
            return;

        runner.convertElements(parent);
        parent.setAttribute(convertedTag, 'true');
    }, false);
    Timer.log();
});