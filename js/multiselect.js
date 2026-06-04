// ============================================================
//  체크박스 복수 선택 드롭다운 (Multi-Select)
//  createMultiSelect(container, {placeholder, allLabel, onChange})
//    .setOptions(options[], selected[])  / .getSelected()
// ============================================================
function createMultiSelect(container, opts = {}) {
    const placeholder = opts.placeholder || '선택';
    const allLabel = opts.allLabel || ('전체 ' + placeholder);
    const onChange = opts.onChange || (() => {});
    let options = [];
    let selected = [];

    container.classList.add('ms');
    container.innerHTML = `
        <button type="button" class="ms-btn"><span class="ms-label"></span><i class="fas fa-chevron-down ms-caret"></i></button>
        <div class="ms-pop" hidden></div>`;
    const btn = container.querySelector('.ms-btn');
    const labelEl = container.querySelector('.ms-label');
    const pop = container.querySelector('.ms-pop');

    function updateLabel() {
        labelEl.textContent = !selected.length ? allLabel
            : selected.length === 1 ? selected[0]
            : `${selected[0]} 외 ${selected.length - 1}개`;
        btn.classList.toggle('ms-active', selected.length > 0);
    }
    function renderPop() {
        pop.innerHTML =
            `<label class="ms-opt ms-opt-all"><input type="checkbox" ${selected.length?'':'checked'} data-all="1"> <b>${allLabel}</b></label>` +
            options.map(o => `<label class="ms-opt"><input type="checkbox" value="${String(o).replace(/"/g,'&quot;')}" ${selected.includes(o)?'checked':''}> ${o}</label>`).join('') ||
            `<div class="ms-empty">옵션 없음</div>`;
        pop.querySelectorAll('input[type=checkbox]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.dataset.all) { selected = []; }
                else {
                    const v = cb.value;
                    if (cb.checked) { if (!selected.includes(v)) selected.push(v); }
                    else selected = selected.filter(x => x !== v);
                }
                updateLabel(); renderPop(); onChange(selected.slice());
            });
        });
    }
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !pop.hidden;
        document.querySelectorAll('.ms-pop').forEach(p => p.hidden = true);
        pop.hidden = open;
    });
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) pop.hidden = true; });

    updateLabel();
    return {
        setOptions(o, sel) {
            options = (o || []).slice();
            selected = (sel || []).filter(s => options.includes(s));
            updateLabel(); renderPop();
        },
        getSelected() { return selected.slice(); },
        setSelected(sel) { selected = (sel||[]).filter(s=>options.includes(s)); updateLabel(); renderPop(); },
    };
}
window.createMultiSelect = createMultiSelect;
