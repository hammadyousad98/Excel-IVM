import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface SearchableDropdownProps {
    options: { id: string | number, label: string }[];
    value: string | number;
    onChange: (val: string | number) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string; // Allow custom styling
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
    options,
    value,
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

    // Calculate position and open
    const toggleOpen = () => {
        if (disabled) return;
        if (!isOpen) {
            if (wrapperRef.current) {
                const rect = wrapperRef.current.getBoundingClientRect();
                setPosition({
                    top: rect.bottom + 2, // Slight gap
                    left: rect.left,
                    width: Math.max(rect.width, 200) // Ensure at least 200px wide
                });
            }
            setIsOpen(true);
            setFocusedIndex(-1);
        } else {
            setIsOpen(false);
        }
    };

    // Close on scroll or resize to prevent detachment
    useEffect(() => {
        if (isOpen) {
            const handleScroll = (e: Event) => {
                // If the scroll event happened inside our menu, don't close
                if (menuRef.current && menuRef.current.contains(e.target as Node)) {
                    return;
                }
                setIsOpen(false);
            };
            const handleResize = () => setIsOpen(false);

            // Capture phase true ensures we catch scroll events from any container
            window.addEventListener('scroll', handleScroll, true);
            window.addEventListener('resize', handleResize);

            return () => {
                window.removeEventListener('scroll', handleScroll, true);
                window.removeEventListener('resize', handleResize);
            };
        }
    }, [isOpen]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // Check wrapper (trigger)
            if (wrapperRef.current && wrapperRef.current.contains(event.target as Node)) {
                return;
            }
            // Check menu (content in portal)
            if (menuRef.current && menuRef.current.contains(event.target as Node)) {
                return;
            }
            setIsOpen(false);
        };

        if (isOpen) {
            // Use mousedown to capture click before it bubbles or performs action
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    // Reset search when opening
    useEffect(() => {
        if (isOpen) {
            setSearch('');
            // Focus input after render
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const filtered = options.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase())
    );

    // Reset focused index when search changes
    useEffect(() => {
        setFocusedIndex(-1);
    }, [search]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                toggleOpen();
            }
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
                    onChange(filtered[focusedIndex].id);
                    setIsOpen(false);
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

    // Scroll focused item into view
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

    const selectedOption = options.find(o => o.id === value);
    const selectedLabel = selectedOption ? selectedOption.label : '';

    return (
        <div className={`relative ${className}`} ref={wrapperRef}>
            <div
                className={`w-full border rounded px-2 py-1 text-sm flex justify-between items-center cursor-pointer bg-white min-h-[30px] ${disabled ? 'bg-gray-100 cursor-not-allowed text-gray-400' : 'hover:border-blue-400 focus:ring-2 focus:ring-blue-500'}`}
                onClick={toggleOpen}
                tabIndex={disabled ? -1 : 0}
                onKeyDown={handleKeyDown}
            >
                <div className="flex-1 truncate mr-2">
                    <span className={`block truncate ${selectedLabel ? 'text-gray-800' : 'text-gray-400'}`}>
                        {selectedLabel || placeholder}
                    </span>
                </div>
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
                        {filtered.length > 0 ? filtered.map((opt, idx) => (
                            <div
                                key={opt.id}
                                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${idx === focusedIndex ? 'bg-blue-100 text-blue-700 font-bold' : opt.id === value ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-blue-50'}`}
                                onClick={() => {
                                    onChange(opt.id);
                                    setIsOpen(false);
                                }}
                            >
                                {opt.label}
                            </div>
                        )) : (
                            <div className="px-3 py-2 text-sm text-gray-400 text-center italic">No results found</div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
