/**
 * Folder2Context
 * Industry-ready Project-to-Text conversion tool for AI context.
 */

const CONFIG = {
    // Directories usually irrelevant for LLM context
    IGNORE_DIRS: [
        'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
        '__pycache__', 'venv', '.venv', 'env', '.env', 'vendor',
        'target', 'out', '.cache', '.idea', '.vscode', '.DS_Store',
        'bower_components', 'tmp', 'temp', 'terraform.tfstate.d',
        'migrations', 'bin', 'obj'
    ],
    // Primary text-based extensions to include
    TEXT_EXTENSIONS: [
        '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.scss',
        '.sass', '.less', '.md', '.markdown', '.txt', '.py', '.java',
        '.go', '.php', '.rb', '.cs', '.cpp', '.c', '.h', '.hpp',
        '.xml', '.yml', '.yaml', '.toml', '.ini', '.conf', '.config',
        '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat',
        '.vue', '.svelte', '.swift', '.kt', '.rs', '.dart', '.lua',
        '.r', '.m', '.scala', '.gradle', '.properties', '.tf', '.env.example'
    ],
    MAX_FILE_SIZE: 1000_000, // 1MB cap per file
    TOKENS_PER_CHAR: 0.28 // Approximation (roughly 3.5 chars per token)
};

// Global State
const state = {
    files: [],            // Flat list of file objects
    selectedPaths: new Set(),
    projectName: '',
    folderHandle: null,
    currentStep: 1,
    activeFilters: new Set()
};

// UI Elements Cache
const el = {
    // Navigation
    backBtn: document.getElementById('backBtn'),
    steps: [
        document.getElementById('step1-indicator'),
        document.getElementById('step2-indicator'),
        document.getElementById('step3-indicator')
    ],

    // View Sections
    views: {
        upload: document.getElementById('uploadSection'),
        selection: document.getElementById('selectionSection'),
        output: document.getElementById('outputSection')
    },

    // Step 1
    uploadZone: document.getElementById('uploadZone'),
    browserWarning: document.getElementById('browserWarning'),

    // Step 2
    projectName: document.getElementById('projectName'),
    fileCountBadge: document.getElementById('fileCountBadge'),
    dirCountBadge: document.getElementById('dirCountBadge'),
    fileTree: document.getElementById('fileTree'),
    fileSearch: document.getElementById('fileSearch'),
    filterContainer: document.getElementById('filterContainer'),
    selectAllBtn: document.getElementById('selectAllBtn'),
    deselectAllBtn: document.getElementById('deselectAllBtn'),
    proceedBtn: document.getElementById('proceedBtn'),
    selectedCount: document.getElementById('selectedCount'),
    totalSize: document.getElementById('totalSize'),
    tokenCount: document.getElementById('tokenCount'),
    tokenProgress: document.getElementById('tokenProgress'),

    // Step 3
    output: document.getElementById('output'),
    copyBtn: document.getElementById('copyBtn'),
    copyStructureBtn: document.getElementById('copyStructureBtn'),
    downloadTxtBtn: document.getElementById('downloadTxtBtn'),
    downloadJsonBtn: document.getElementById('downloadJsonBtn'),
    finalStats: document.getElementById('finalStats'),

    // Modals & Tools
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewContent: document.getElementById('previewContent'),
    closePreview: document.getElementById('closePreview'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toastMessage')
};

/**
 * Core Initialization
 */
function init() {
    // Check for File System Access API
    if (!('showDirectoryPicker' in window)) {
        el.browserWarning.style.display = 'flex';
        el.uploadZone.classList.add('disabled');
        return;
    } else {
        el.browserWarning.style.display = 'none';
    }

    // Event Listeners
    el.uploadZone.addEventListener('click', handleDirectoryOpen);
    el.backBtn.addEventListener('click', goBack);
    el.selectAllBtn.addEventListener('click', () => toggleAll(true));
    el.deselectAllBtn.addEventListener('click', () => toggleAll(false));
    el.proceedBtn.addEventListener('click', generateContext);
    el.fileSearch.addEventListener('input', handleSearch);
    
    el.copyBtn.addEventListener('click', () => copyToClipboard(el.output.value, 'Full context copied!'));
    el.copyStructureBtn.addEventListener('click', () => {
        const structureOnly = buildContextOutput(state.files.filter(f => state.selectedPaths.has(f.path)), true);
        copyToClipboard(structureOnly, 'Structure copied!');
    });

    el.downloadTxtBtn.addEventListener('click', downloadMarkdown);
    el.downloadJsonBtn.addEventListener('click', downloadJson);
    el.closePreview.addEventListener('click', () => el.previewModal.classList.remove('active'));

    // Lucide Icons Render
    lucide.createIcons();
}

/**
 * State & Navigation
 */
function updateStepUI(step) {
    state.currentStep = step;
    el.steps.forEach((s, i) => {
        s.classList.toggle('active', i + 1 === step);
        s.classList.toggle('completed', i + 1 < step);
    });

    Object.entries(el.views).forEach(([key, view]) => {
        const viewName = step === 1 ? 'upload' : step === 2 ? 'selection' : 'output';
        view.classList.toggle('hidden', key !== viewName);
    });

    el.backBtn.classList.toggle('hidden', step === 1);
}

function goBack() {
    if (state.currentStep > 1) updateStepUI(state.currentStep - 1);
}

/**
 * File Scanning Logic
 */
async function handleDirectoryOpen() {
    try {
        const handle = await window.showDirectoryPicker();
        state.folderHandle = handle;
        state.projectName = handle.name;
        
        showLoading('Scanning file system...');
        state.files = [];
        await scanRecursive(handle, '');
        
        // Filter out non-text or massive files
        state.files = state.files.filter(f => {
            const ext = '.' + f.name.split('.').pop().toLowerCase();
            return CONFIG.TEXT_EXTENSIONS.includes(ext) && f.size <= CONFIG.MAX_FILE_SIZE;
        });

        // Default selection: All
        state.selectedPaths = new Set(state.files.map(f => f.path));
        
        hideLoading();
        prepareSelectionView();
        updateStepUI(2);
    } catch (err) {
        hideLoading();
        if (err.name !== 'AbortError') showToast('Error opening directory', true);
    }
}

async function scanRecursive(handle, parentPath) {
    for await (const entry of handle.values()) {
        const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        
        if (CONFIG.IGNORE_DIRS.includes(entry.name)) continue;

        if (entry.kind === 'file') {
            const file = await entry.getFile();
            state.files.push({
                name: entry.name,
                path: path,
                size: file.size,
                handle: entry,
                extension: '.' + entry.name.split('.').pop().toLowerCase()
            });
        } else {
            await scanRecursive(entry, path);
        }
    }
}

/**
 * Selection View Logic
 */
function prepareSelectionView() {
    el.projectName.textContent = state.projectName;
    
    // Update Badge Counts
    const fileCount = state.files.length;
    const folderSet = new Set();
    state.files.forEach(f => {
        const parts = f.path.split('/');
        if (parts.length > 1) {
            for (let i = 1; i < parts.length; i++) {
                folderSet.add(parts.slice(0, i).join('/'));
            }
        }
    });
    
    el.fileCountBadge.textContent = `${fileCount} Files`;
    el.dirCountBadge.textContent = `${folderSet.size} Folders`;

    renderFileTree();
    renderFilters();
    updateStats();
    lucide.createIcons();
}

function renderFilters() {
    el.filterContainer.innerHTML = '';
    const exts = [...new Set(state.files.map(f => f.extension))].sort();
    
    exts.forEach(ext => {
        const btn = document.createElement('div');
        btn.className = 'filter-pill';
        btn.textContent = ext;
        btn.onclick = () => {
            btn.classList.toggle('active');
            if (state.activeFilters.has(ext)) state.activeFilters.delete(ext);
            else state.activeFilters.add(ext);
            handleSearch(); // Refresh list based on filters
        };
        el.filterContainer.appendChild(btn);
    });
}

function renderFileTree() {
    const tree = {};
    state.files.forEach(f => {
        const parts = f.path.split('/');
        let current = tree;
        parts.forEach((part, i) => {
            if (i === parts.length - 1) {
                if (!current.files) current.files = [];
                current.files.push(f);
            } else {
                if (!current.folders) current.folders = {};
                if (!current.folders[part]) current.folders[part] = { files: [], folders: {} };
                current = current.folders[part];
            }
        });
    });

    el.fileTree.innerHTML = '';
    const container = document.createElement('div');
    renderNode(tree, container, '');
    el.fileTree.appendChild(container);
}

function renderNode(node, container, currentPath) {
    // Folders first
    if (node.folders) {
        Object.entries(node.folders).sort().forEach(([name, subNode]) => {
            const folderPath = currentPath ? `${currentPath}/${name}` : name;
            const folderEl = document.createElement('div');
            folderEl.className = 'folder-wrapper';
            
            const header = document.createElement('div');
            header.className = 'tree-item folder-item';
            
            // Check if folder is fully selected
            const folderFiles = state.files.filter(f => f.path.startsWith(folderPath + '/'));
            const isAllSelected = folderFiles.every(f => state.selectedPaths.has(f.path));
            const isSomeSelected = folderFiles.some(f => state.selectedPaths.has(f.path));

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'checkbox folder-checkbox';
            checkbox.checked = isAllSelected;
            checkbox.indeterminate = !isAllSelected && isSomeSelected;
            
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleFolderSelection(folderPath, checkbox.checked);
            };

            const arrow = `<i data-lucide="chevron-down" class="folder-arrow"></i>`;
            const icon = `<i data-lucide="folder" class="item-icon"></i>`;
            
            header.appendChild(checkbox);
            const content = document.createElement('div');
            content.className = 'folder-header-content';
            content.innerHTML = `${arrow}${icon}<span class="item-name">${name}</span>`;
            header.appendChild(content);
            
            const children = document.createElement('div');
            children.className = 'folder-children';
            
            content.onclick = (e) => {
                e.stopPropagation();
                const arrowIcon = header.querySelector('.folder-arrow');
                arrowIcon.classList.toggle('collapsed');
                children.classList.toggle('hidden');
            };

            folderEl.appendChild(header);
            folderEl.appendChild(children);
            container.appendChild(folderEl);
            renderNode(subNode, children, folderPath);
        });
    }

    // Files
    if (node.files) {
        node.files.sort((a,b) => a.name.localeCompare(b.name)).forEach(file => {
            const fileEl = document.createElement('div');
            fileEl.className = 'tree-item file-item';
            fileEl.dataset.path = file.path;
            
            const isChecked = state.selectedPaths.has(file.path);
            const sizeStr = (file.size / 1024).toFixed(1) + ' KB';
            
            fileEl.innerHTML = `
                <input type="checkbox" class="checkbox file-checkbox" ${isChecked ? 'checked' : ''}>
                <div class="item-icon"><i data-lucide="file-text"></i></div>
                <span class="item-name">${file.name}</span>
                <span class="item-meta">${sizeStr}</span>
                <button class="btn btn-sm btn-ghost preview-trigger" title="Preview"><i data-lucide="eye"></i></button>
            `;

            const cb = fileEl.querySelector('.file-checkbox');
            cb.onclick = (e) => {
                e.stopPropagation();
                if (cb.checked) state.selectedPaths.add(file.path);
                else state.selectedPaths.delete(file.path);
                updateStats();
            };

            fileEl.onclick = () => cb.click();
            fileEl.querySelector('.preview-trigger').onclick = (e) => {
                e.stopPropagation();
                showFilePreview(file);
            };

            container.appendChild(fileEl);
        });
    }
}

/**
 * Logic Helpers
 */
function toggleFolderSelection(folderPath, isSelected) {
    state.files.forEach(f => {
        if (f.path.startsWith(folderPath + '/')) {
            if (isSelected) state.selectedPaths.add(f.path);
            else state.selectedPaths.delete(f.path);
        }
    });
    
    // Update DOM
    document.querySelectorAll(`.file-item`).forEach(item => {
        const path = item.dataset.path;
        if (path.startsWith(folderPath + '/')) {
            item.querySelector('.file-checkbox').checked = isSelected;
        }
    });
    
    updateStats();
}

function updateStats() {
    const selected = state.files.filter(f => state.selectedPaths.has(f.path));
    const totalBytes = selected.reduce((acc, f) => acc + f.size, 0);
    const tokens = Math.ceil(totalBytes * CONFIG.TOKENS_PER_CHAR);
    
    el.selectedCount.textContent = selected.length;
    el.totalSize.textContent = (totalBytes / 1024).toFixed(1) + ' KB';
    el.tokenCount.textContent = tokens.toLocaleString();
    
    const progress = Math.min((tokens / 100000) * 100, 100);
    el.tokenProgress.style.width = `${progress}%`;
    el.tokenProgress.style.background = tokens > 80000 ? 'var(--danger)' : 'var(--primary)';
}

function handleSearch() {
    const query = el.fileSearch.value.toLowerCase();
    document.querySelectorAll('.file-item').forEach(item => {
        const name = item.querySelector('.item-name').textContent.toLowerCase();
        const ext = '.' + name.split('.').pop();
        
        const matchesQuery = name.includes(query);
        const matchesFilter = state.activeFilters.size === 0 || state.activeFilters.has(ext);
        
        item.style.display = (matchesQuery && matchesFilter) ? 'flex' : 'none';
    });
}

function toggleAll(check) {
    state.selectedPaths = check ? new Set(state.files.map(f => f.path)) : new Set();
    document.querySelectorAll('.checkbox').forEach(cb => cb.checked = check);
    updateStats();
}

/**
 * Generation & Output
 */
async function generateContext() {
    const selected = state.files.filter(f => state.selectedPaths.has(f.path));
    if (selected.length === 0) return showToast('Select at least one file', true);

    showLoading('Building context string...');
    
    try {
        const fileContents = await Promise.all(selected.map(async f => {
            const fileObj = await f.handle.getFile();
            const text = await fileObj.text();
            return { path: f.path, content: text };
        }));

        const outputText = buildContextOutput(fileContents);
        el.output.value = outputText;
        
        const tokens = Math.ceil(outputText.length * CONFIG.TOKENS_PER_CHAR);
        el.finalStats.textContent = `${outputText.length.toLocaleString()} chars • ~${tokens.toLocaleString()} tokens`;
        
        hideLoading();
        updateStepUI(3);
        lucide.createIcons();
    } catch (err) {
        hideLoading();
        showToast('Error reading files', true);
    }
}

function buildContextOutput(files, structureOnly = false) {
    let output = `Folder: ${state.projectName}\n`; // Changed from "Project:" to "Folder:"
    output += `Date: ${new Date().toLocaleDateString()}\n`;
    output += `====================================\n\n`;
    
    output += `DIRECTORY STRUCTURE:\n`;
    output += buildTreeString(files.map(f => f.path));
    output += `\n\n`;

    if (structureOnly) return output;

    output += `FILE CONTENTS:\n`;
    files.forEach(f => {
        output += `\n--- FILE: ${f.path} ---\n`;
        output += f.content;
        output += `\n--- END FILE ---\n`;
    });

    return output;
}

function buildTreeString(paths) {
    const tree = {};
    paths.forEach(p => {
        const parts = p.split('/');
        let cur = tree;
        parts.forEach(part => {
            if (!cur[part]) cur[part] = {};
            cur = cur[part];
        });
    });

    const lines = [];
    function traverse(node, prefix = '') {
        const keys = Object.keys(node).sort();
        keys.forEach((key, i) => {
            const isLast = i === keys.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            lines.push(prefix + connector + key);
            traverse(node[key], prefix + (isLast ? '    ' : '│   '));
        });
    }
    traverse(tree);
    return lines.join('\n');
}

/**
 * Actions & Utilities
 */
async function showFilePreview(file) {
    showLoading('Reading file...');
    try {
        const f = await file.handle.getFile();
        const content = await f.text();
        el.previewTitle.textContent = file.path;
        el.previewContent.textContent = content;
        el.previewModal.classList.add('active');
    } catch (err) {
        showToast('Cannot preview file', true);
    }
    hideLoading();
}

function copyToClipboard(text, msg) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showToast(msg);
    } catch (err) {
        showToast('Copy failed', true);
    }
    document.body.removeChild(textArea);
}

function showToast(msg, isError = false) {
    el.toastMsg.textContent = msg;
    el.toast.style.background = isError ? 'var(--danger)' : 'var(--primary)';
    el.toast.classList.remove('hidden');
    setTimeout(() => el.toast.classList.add('hidden'), 3000);
}

function showLoading(text) {
    el.loadingText.textContent = text;
    el.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    el.loadingOverlay.classList.add('hidden');
}

function downloadMarkdown() {
    const blob = new Blob([el.output.value], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectName}-context.md`;
    a.click();
}

function downloadJson() {
    const data = {
        project: state.projectName,
        files: state.files.filter(f => state.selectedPaths.has(f.path)).map(f => f.path),
        timestamp: new Date().toISOString(),
        raw: el.output.value
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectName}-context.json`;
    a.click();
}

// Global Init
document.addEventListener('DOMContentLoaded', init);