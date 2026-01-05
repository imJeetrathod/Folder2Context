/**
 * Folder2Context
 * Industry-ready Project-to-Text conversion tool for AI context.
 */

const CONFIG = {
    IGNORE_DIRS: [
        'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
        '__pycache__', 'venv', '.venv', 'env', '.env', 'vendor',
        'target', 'out', '.cache', '.idea', '.vscode', '.DS_Store',
        'bower_components', 'tmp', 'temp', 'terraform.tfstate.d',
        'migrations', 'bin', 'obj'
    ],
    TEXT_EXTENSIONS: [
        '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.scss',
        '.sass', '.less', '.md', '.markdown', '.txt', '.py', '.java',
        '.go', '.php', '.rb', '.cs', '.cpp', '.c', '.h', '.hpp',
        '.xml', '.yml', '.yaml', '.toml', '.ini', '.conf', '.config',
        '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat',
        '.vue', '.svelte', '.swift', '.kt', '.rs', '.dart', '.lua',
        '.r', '.m', '.scala', '.groovy', '.gradle', '.properties', '.tf', '.env.example'
    ],
    MAX_FILE_SIZE: 1000_000, // 1MB limit
    TOKENS_PER_CHAR: 0.28
};

const state = {
    files: [],
    selectedPaths: new Set(),
    projectName: '',
    folderHandle: null,
    currentStep: 1,

    // ✅ NEW
    detectedExtensions: new Set(),   // all extensions found in folder
    enabledExtensions: new Set(),    // extensions currently included
    activeFilters: new Set()
};


const el = {
    backBtn: document.getElementById('backBtn'),
    steps: [
        document.getElementById('step1-indicator'),
        document.getElementById('step2-indicator'),
        document.getElementById('step3-indicator')
    ],
    views: {
        upload: document.getElementById('uploadSection'),
        selection: document.getElementById('selectionSection'),
        output: document.getElementById('outputSection')
    },
    uploadZone: document.getElementById('uploadZone'),
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
    output: document.getElementById('output'),
    copyBtn: document.getElementById('copyBtn'),
    copyStructureBtn: document.getElementById('copyStructureBtn'),
    downloadTxtBtn: document.getElementById('downloadTxtBtn'),
    downloadJsonBtn: document.getElementById('downloadJsonBtn'),
    finalStats: document.getElementById('finalStats'),
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewContent: document.getElementById('previewContent'),
    closePreview: document.getElementById('closePreview'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toastMessage'),
    visitCount: document.getElementById('visitCount')
};

function init() {
    if (!('showDirectoryPicker' in window)) {
        el.uploadZone.innerHTML = '<p style="color:red;">Your browser does not support the File System Access API.</p>';
        return;
    }

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

    lucide.createIcons();
}

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

async function handleDirectoryOpen() {
    try {
        const handle = await window.showDirectoryPicker();
        state.folderHandle = handle;
        state.projectName = handle.name;

        showLoading('Scanning file system...');
        state.files = [];
        state.detectedExtensions.clear();
state.enabledExtensions.clear();
state.activeFilters.clear();

        await scanRecursive(handle, '');
// ✅ enable only TEXT_EXTENSIONS by default
state.enabledExtensions = new Set(
    [...state.detectedExtensions].filter(ext =>
        CONFIG.TEXT_EXTENSIONS.includes(ext)
    )
);

// ✅ select only files whose extension is enabled
state.selectedPaths.clear();
state.files.forEach(f => {
    if (
        state.enabledExtensions.has(f.extension) &&
        f.size <= CONFIG.MAX_FILE_SIZE
    ) {
        state.selectedPaths.add(f.path);
    }
});

// keep filters in sync
state.activeFilters = new Set(state.enabledExtensions);


        hideLoading();
        prepareSelectionView();
        updateStepUI(2);
    } catch (err) {
        hideLoading();
        console.error(err);
    }
}

async function scanRecursive(handle, parentPath) {
    for await (const entry of handle.values()) {
        const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        if (CONFIG.IGNORE_DIRS.includes(entry.name)) continue;

        if (entry.kind === 'file') {
            const file = await entry.getFile();
            const extension = '.' + entry.name.split('.').pop().toLowerCase();
state.detectedExtensions.add(extension);

state.files.push({
    name: entry.name,
    path: path,
    size: file.size,
    handle: entry,
    extension
});

        } else {
            await scanRecursive(entry, path);
        }
    }
}

function prepareSelectionView() {
    el.projectName.textContent = state.projectName;
    const folderSet = new Set();
    state.files.forEach(f => {
        const parts = f.path.split('/');
        for (let i = 1; i < parts.length; i++) {
            folderSet.add(parts.slice(0, i).join('/'));
        }
    });
    el.fileCountBadge.textContent = `${state.files.length} Files`;
    el.dirCountBadge.textContent = `${folderSet.size} Folders`;

    renderFileTree();
    renderFilters();
    updateStats();
}

function renderFilters() {
    el.filterContainer.innerHTML = '';
    const allExts = [...new Set(state.files.map(f => f.extension))].sort();
    allExts.forEach(ext => {
        const btn = document.createElement('div');
        btn.className = `filter-pill ${state.activeFilters.has(ext) ? 'active' : ''}`;
        btn.textContent = ext;
        btn.onclick = () => {
    showLoading('Updating selection...');

    if (state.enabledExtensions.has(ext)) {
        state.enabledExtensions.delete(ext);
        state.files.forEach(f => {
            if (f.extension === ext) state.selectedPaths.delete(f.path);
        });
    } else {
        state.enabledExtensions.add(ext);
        state.files.forEach(f => {
            if (f.extension === ext && f.size <= CONFIG.MAX_FILE_SIZE) {
                state.selectedPaths.add(f.path);
            }
        });
    }

    state.activeFilters = new Set(state.enabledExtensions);

    renderFilters();
    handleSearch();
    renderFileTree();
    updateStats();
    hideLoading();
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
    lucide.createIcons();
}

function renderNode(node, container, currentPath) {
    if (node.folders) {
        Object.entries(node.folders).sort(([a], [b]) => a.localeCompare(b)).forEach(([name, subNode]) => {
            const folderPath = currentPath ? `${currentPath}/${name}` : name;
            const folderEl = document.createElement('div');
            folderEl.className = 'folder-wrapper';

            const header = document.createElement('div');
            header.className = 'tree-item folder-item';

            const folderFiles = state.files.filter(f => f.path.startsWith(folderPath + '/'));
            const isAllSelected = folderFiles.length > 0 && folderFiles.every(f => state.selectedPaths.has(f.path));
            const isSomeSelected = folderFiles.some(f => state.selectedPaths.has(f.path));

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'checkbox';
            checkbox.checked = isAllSelected;
            checkbox.indeterminate = !isAllSelected && isSomeSelected;
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleFolderSelection(folderPath, checkbox.checked);
            };

            const content = document.createElement('div');
            content.className = 'folder-header-content';
            content.innerHTML = `<i data-lucide="chevron-down" class="folder-arrow"></i><i data-lucide="folder" class="item-icon"></i><span class="item-name">${name}</span>`;

            header.appendChild(checkbox);
            header.appendChild(content);

            const children = document.createElement('div');
            children.className = 'folder-children hidden';

            content.onclick = () => {
                header.querySelector('.folder-arrow').classList.toggle('collapsed');
                children.classList.toggle('hidden');
            };

            folderEl.appendChild(header);
            folderEl.appendChild(children);
            container.appendChild(folderEl);

            renderNode(subNode, children, folderPath);
        });
    }

    if (node.files) {
        node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
            const fileEl = document.createElement('div');
            fileEl.className = 'tree-item file-item';
            fileEl.dataset.path = file.path;

            const isChecked = state.selectedPaths.has(file.path);

            fileEl.innerHTML = `
                <input type="checkbox" class="checkbox file-checkbox" ${isChecked ? 'checked' : ''}>
                <div class="item-icon"><i data-lucide="file-text"></i></div>
                <span class="item-name">${file.name}</span>
                <span class="item-meta">${(file.size / 1024).toFixed(1)} KB</span>
                <button class="btn btn-sm btn-ghost preview-trigger"><i data-lucide="eye"></i></button>
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

function toggleFolderSelection(folderPath, isSelected) {
    state.files.forEach(f => {
        if (f.path.startsWith(folderPath + '/')) {
            isSelected ? state.selectedPaths.add(f.path) : state.selectedPaths.delete(f.path);
        }
    });
    updateStats();
    renderFileTree();
}

function updateStats() {
    const selected = state.files.filter(f => state.selectedPaths.has(f.path));
    const totalBytes = selected.reduce((acc, f) => acc + f.size, 0);
    const tokens = Math.ceil(totalBytes * CONFIG.TOKENS_PER_CHAR);

    el.selectedCount.textContent = selected.length;
    el.totalSize.textContent = (totalBytes / 1024).toFixed(1) + ' KB';
    el.tokenCount.textContent = tokens.toLocaleString();
    el.tokenProgress.style.width = `${Math.min((tokens / 100000) * 100, 100)}%`;
}

function handleSearch() {
    const query = el.fileSearch.value.toLowerCase();
    document.querySelectorAll('.file-item').forEach(item => {
        const name = item.querySelector('.item-name').textContent.toLowerCase();
        const ext = '.' + name.split('.').pop();
        const matchesQuery = name.includes(query);
        const matchesFilter = state.activeFilters.has(ext);
        item.style.display = (matchesQuery && matchesFilter) ? 'flex' : 'none';
    });
}

function toggleAll(check) {
    state.selectedPaths.clear();

    if (check) {
        state.files.forEach(f => {
            if (f.size <= CONFIG.MAX_FILE_SIZE) {
                state.selectedPaths.add(f.path);
            }
        });
        state.enabledExtensions = new Set(state.detectedExtensions);
    } else {
        state.enabledExtensions.clear();
    }

    state.activeFilters = new Set(state.enabledExtensions);
    renderFilters();
    renderFileTree();
    updateStats();
}


async function generateContext() {
    const selected = state.files.filter(f => state.selectedPaths.has(f.path));
    if (selected.length === 0) return showToast('Select at least one file', true);

    showLoading('Building context...');
    try {
        const fileContents = await Promise.all(selected.map(async f => {
            const fileObj = await f.handle.getFile();
            return { path: f.path, content: await fileObj.text() };
        }));

        el.output.value = buildContextOutput(fileContents);
        el.finalStats.textContent = `${el.output.value.length.toLocaleString()} chars • ~${Math.ceil(el.output.value.length * CONFIG.TOKENS_PER_CHAR).toLocaleString()} tokens`;

        hideLoading();
        updateStepUI(3);
    } catch (err) {
        hideLoading();
        console.error(err);
    }
}

function buildContextOutput(files, structureOnly = false) {
    let output = `Folder: ${state.projectName}\nDate: ${new Date().toLocaleDateString()}\n====================================\n\nDIRECTORY STRUCTURE:\n${buildTreeString(files.map(f => f.path))}\n\n`;
    if (structureOnly) return output;
    output += `FILE CONTENTS:\n`;
    files.forEach(f => output += `\n--- FILE: ${f.path} ---\n${f.content}\n--- END FILE ---\n`);
    return output;
}

function buildTreeString(paths) {
    const tree = {};
    paths.forEach(p => {
        let cur = tree;
        p.split('/').forEach(part => {
            if (!cur[part]) cur[part] = {};
            cur = cur[part];
        });
    });

    const lines = [];
    function traverse(node, prefix = '') {
        const keys = Object.keys(node).sort();
        keys.forEach((key, i) => {
            const isLast = i === keys.length - 1;
            lines.push(prefix + (isLast ? '└── ' : '├── ') + key);
            traverse(node[key], prefix + (isLast ? '    ' : '│   '));
        });
    }
    traverse(tree);
    return lines.join('\n');
}

async function showFilePreview(file) {
    try {
        const f = await file.handle.getFile();
        el.previewTitle.textContent = file.path;
        el.previewContent.textContent = await f.text();
        el.previewModal.classList.add('active');
    } catch (err) {
        console.error(err);
    }
}

function copyToClipboard(text, msg) {
    navigator.clipboard.writeText(text).then(() => {
        showToast(msg);
    }).catch(() => {
        // Fallback
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast(msg);
    });
}

function showToast(msg, isError = false) {
    el.toastMsg.textContent = msg;
    el.toast.style.background = isError ? '#dc3545' : '#28a745';
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.projectName}-context.md`;
    a.click();
}

function downloadJson() {
    const data = {
        project: state.projectName,
        date: new Date().toISOString(),
        context: el.output.value
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.projectName}-context.json`;
    a.click();
}

// Visit Counter — Fixed & Working
document.addEventListener('DOMContentLoaded', () => {
    // Increment counter and display the new total
    fetch('https://api.counterapi.dev/v1/folder2context/visits/up')
        .then(response => response.json())
        .then(data => {
            if (data && data.count !== undefined) {
                el.visitCount.textContent = data.count.toLocaleString();
            } else {
                el.visitCount.textContent = '—';
            }
        })
        .catch(() => {
            el.visitCount.textContent = '—';
        });

    init();
});