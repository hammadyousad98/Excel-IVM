import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface MultiSelectSearchableDropdownProps {
    options: { id: string | number, label: string }[];
    value: (string | number)[];
    onChange: (val: (string | number)[]) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

export const MultiSelectSearchableDropdown: React.FC<MultiSelectSearchableDropdownProps> = ({
    options,
    value = [],
    onChange,
    placeholder = "Select...",
    disabled = false,
    className = ""
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
    const wrapperRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const toggleOpen = () => {
        if (disabled) return;
        if (!isOpen) {
            if (wrapperRef.current) {
                const rect = wrapperRef.current.getBoundingClientRect();
                setPosition({
                    top: rect.bottom + 2,
                    left: rect.left,
                    width: Math.max(rect.width, 200)
                });
            }
            setIsOpen(true);
            setFocusedIndex(-1);
        } else {
            setIsOpen(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            const handleScroll = (e: Event) => {
                if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
                setIsOpen(false);
            };
            const handleResize = () => setIsOpen(false);
            window.addEventListener('scroll', handleScroll, true);
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('scroll', handleScroll, true);
                window.removeEventListener('resize', handleResize);
            };
        }
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && wrapperRef.current.contains(event.target as Node)) return;
            if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
            setIsOpen(false);
        };
        if (isOpen) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setSearch('');
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const filtered = options.filter(o =>
        (o.label || "").toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => {
        setFocusedIndex(-1);
    }, [search]);

    const handleSelect = (id: string | number) => {
        const newValue = value.includes(id)
            ? value.filter(v => v !== id)
            : [...value, id];
        onChange(newValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') toggleOpen();
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
                break;
            case 'Enter':
                e.preventDefault();
                if (focusedIndex >= 0 && filtered[focusedIndex]) {
                    handleSelect(filtered[focusedIndex].id);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                break;
            case 'Tab':
                setIsOpen(false);
                break;
        }
    };

    useEffect(() => {
        if (focusedIndex >= 0 && menuRef.current) {
            const listContainer = menuRef.current.querySelector('.overflow-y-auto');
            if (listContainer) {
                const focusedElement = listContainer.children[focusedIndex] as HTMLElement;
                if (focusedElement) {
                    focusedElement.scrollIntoView({ block: 'nearest' });
                }
            }
        }
    }, [focusedIndex]);

    const selectedLabels = options
        .filter(o => value.includes(o.id))
        .map(o => o.label);

    return (
        <div className={`relative ${className}`} ref={wrapperRef}>
            <div
                className={`w-full border rounded px-2 py-1 text-sm flex flex-wrap gap-1 items-center cursor-pointer bg-white min-h-[38px] ${disabled ? 'bg-gray-100 cursor-not-allowed text-gray-400' : 'hover:border-blue-400 focus:ring-2 focus:ring-blue-500'}`}
                onClick={toggleOpen}
                tabIndex={disabled ? -1 : 0}
                onKeyDown={handleKeyDown}
            >
                {selectedLabels.length > 0 ? (
                    selectedLabels.map((label, idx) => (
                        <span key={idx} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1">
                            {label}
                            {!disabled && (
                                <span 
                                    className="hover:text-blue-900 cursor-pointer"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const id = options.find(o => o.label === label)?.id;
                                        if (id !== undefined) handleSelect(id);
                                    }}
                                >
                                    &times;
                                </span>
                            )}
                        </span>
                    ))
                ) : (
                    <span className="text-gray-400">{placeholder}</span>
                )}
                <div className="flex-1"></div>
                <span className="text-gray-400 text-xs flex-shrink-0">▼</span>
            </div>

            {isOpen && createPortal(
                <div
                    ref={menuRef}
                    className="fixed bg-white border rounded shadow-xl z-[9999] flex flex-col animate-in fade-in zoom-in-95 duration-100"
                    style={{
                        top: position.top,
                        left: position.left,
                        minWidth: position.width,
                        maxWidth: '90vw',
                        maxHeight: '300px'
                    }}
                >
                    <div className="p-2 border-b">
                        <input
                            ref={inputRef}
                            type="text"
                            className="w-full border rounded px-2 py-1 text-sm focus:outline-blue-500"
                            placeholder="Type to search..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                    <div className="overflow-y-auto flex-1 custom-scrollbar" style={{ maxHeight: '250px' }}>
                        {filtered.length > 0 ? filtered.map((opt, idx) => {
                            const isSelected = value.includes(opt.id);
                            return (
                                <div
                                    key={opt.id}
                                    className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center justify-between ${idx === focusedIndex ? 'bg-blue-100 text-blue-700 font-bold' : isSelected ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-blue-50'}`}
                                    onClick={() => handleSelect(opt.id)}
                                >
                                    <span>{opt.label}</span>
                                    {isSelected && <span className="text-blue-600">✓</span>}
                                </div>
                            );
                        }) : (
                            <div className="px-3 py-2 text-sm text-gray-400 text-center italic">No results found</div>
                        )}
                    </div>
                    <div className="p-2 border-t text-right">
                        <button 
                            className="text-white bg-blue-600 px-3 py-1 rounded text-xs font-bold hover:bg-blue-700"
                            onClick={() => setIsOpen(false)}
                        >
                            Done
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
