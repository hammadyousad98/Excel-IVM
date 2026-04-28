import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Updated type definition to include 'blob'

const formatCurrency = (amount: any) => {
    const val = Number(amount || 0);
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const formatNumber = (num: any) => {
    const val = Number(num || 0);
    return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const formatDate = (dateStr: any) => {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    } catch (e) {
        return dateStr;
    }
}

export const generatePOPdf = async (
    po: any,
    companySettings: any,
    mode: 'save' | 'print' | 'blob' | 'datauristring' = 'save',
    title: string = 'PURCHASE ORDER'
) => {
    const doc = new jsPDF()

    // --- Header ---
    doc.setFontSize(23)
    doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 20)

    // Logo (Top Right)
    if (companySettings?.logo_path) {
        try {
            doc.addImage(companySettings.logo_path, 'PNG', 150, 10, 40, 20)
        } catch (e) {
            console.error('Failed to add logo', e)
        }
    }

    // --- Layout Constants ---
    const marginLeft = 14
    const contentWidth = 182 // 210 (A4) - 14 (Left) - 14 (Right)
    const col1Width = 92
    const col2Width = 90 // 92 + 90 = 182
    const rowHeight = 8 // Increased from 7
    const boxTopY = 40

    // --- Boxes ---
    doc.setLineWidth(0.5)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')

    // --- Right Column (PO Details) ---
    const rightX = marginLeft + col1Width

    // Date & PO Number Row
    doc.rect(rightX, boxTopY, col2Width, rowHeight * 2)
    doc.line(rightX + col2Width / 2, boxTopY, rightX + col2Width / 2, boxTopY + rowHeight * 2)

    doc.setFont('helvetica', 'bold')
    doc.text('Date :', rightX + 2, boxTopY + 5)
    doc.text('PO Number :', rightX + col2Width / 2 + 2, boxTopY + 5)

    doc.setFont('helvetica', 'normal')
    doc.text(formatDate(po.date), rightX + 15, boxTopY + 11)

    // Wrap PO Number
    const poNumWidth = (col2Width / 2) - 4
    const poNumText = doc.splitTextToSize(po.order_no || `${po.id}`, poNumWidth)
    doc.text(poNumText, rightX + col2Width / 2 + 2, boxTopY + 11)

    // Contact Person
    let currentY = boxTopY + rowHeight * 2
    doc.rect(rightX, currentY, col2Width, rowHeight)
    doc.setFont('helvetica', 'bold')
    doc.text('Contact Person Name :', rightX + 2, currentY + 6)
    doc.setFont('helvetica', 'normal')

    // Supplier DN
    currentY += rowHeight
    doc.rect(rightX, currentY, col2Width, rowHeight)
    doc.setFont('helvetica', 'bold')
    doc.text("Supplier's DN Number", rightX + 2, currentY + 6)

    // Currency & Payment Term
    currentY += rowHeight
    doc.rect(rightX, currentY, col2Width, rowHeight * 2)
    doc.line(rightX + col2Width / 2, currentY, rightX + col2Width / 2, currentY + rowHeight * 2)

    doc.setFont('helvetica', 'bold')
    doc.text('Currency :', rightX + 2, currentY + 6)
    doc.text('Payment Term :', rightX + col2Width / 2 + 2, currentY + 6)

    doc.setFont('helvetica', 'normal')
    doc.text('PKR', rightX + 5, currentY + 12)
    doc.text('______ Days', rightX + col2Width / 2 + 5, currentY + 12)

    // Mode of Payment & Shipment Term
    currentY += rowHeight * 2
    doc.rect(rightX, currentY, col2Width, rowHeight * 2)
    doc.line(rightX + col2Width / 2, currentY, rightX + col2Width / 2, currentY + rowHeight * 2)

    doc.setFont('helvetica', 'bold')
    doc.text('Mode of Payment :', rightX + 2, currentY + 6)
    doc.text('Shipment Term :', rightX + col2Width / 2 + 2, currentY + 6)

    doc.setFont('helvetica', 'normal')
    doc.text('Cheque / Cash', rightX + 5, currentY + 12)
    doc.text('Ex work', rightX + col2Width / 2 + 5, currentY + 12)

    // Delivery Time & Place
    currentY += rowHeight * 2
    // Increase height for Delivery Place (was rowHeight * 3)
    const deliveryBoxHeight = rowHeight * 4
    doc.rect(rightX, currentY, col2Width, deliveryBoxHeight)
    doc.line(rightX + col2Width / 2, currentY, rightX + col2Width / 2, currentY + deliveryBoxHeight)

    doc.setFont('helvetica', 'bold')
    doc.text('Delivery Time :', rightX + 2, currentY + 6)
    doc.text('Delivery Place :', rightX + col2Width / 2 + 2, currentY + 6)

    doc.setFont('helvetica', 'normal')
    doc.text(formatDate(po.date), rightX + 5, currentY + 12)

    // Delivery Place - Ensure it stays in box
    const addressWidth = (col2Width / 2) - 4
    const addressLines = doc.splitTextToSize(companySettings?.address || '', addressWidth)
    doc.text(addressLines, rightX + col2Width / 2 + 2, currentY + 12)


    // --- Left Column (Seller & Buyer) ---
    // Seller
    doc.rect(marginLeft, boxTopY, col1Width, (rowHeight * 5))
    doc.setFont('helvetica', 'bold')
    doc.text('Seller:', marginLeft + 2, boxTopY + 6)
    doc.setFont('helvetica', 'normal')
    doc.text(po.supplier_name || '', marginLeft + 2, boxTopY + 12)

    // Extract block for Seller Address to wrap text
    const sellerAddressWidth = col1Width - 4
    const sellerAddressLines = doc.splitTextToSize(po.supplier_address || '', sellerAddressWidth)
    doc.text(sellerAddressLines, marginLeft + 2, boxTopY + 18)

    // Seller Phone
    let sellerPhoneY = boxTopY + 18 + (sellerAddressLines.length * 5)
    if (po.supplier_phone) {
        doc.text(`Tel: ${po.supplier_phone}`, marginLeft + 2, sellerPhoneY)
    }

    // Buyer
    const buyerY = boxTopY + (rowHeight * 5)
    // Calculate buyer box height to match the bottom of the right column
    // Right column ends at: currentY + deliveryBoxHeight
    const rightColumnBottom = currentY + deliveryBoxHeight
    const buyerHeight = rightColumnBottom - buyerY

    doc.rect(marginLeft, buyerY, col1Width, buyerHeight)

    doc.setFont('helvetica', 'bold')
    doc.text('Buyer:', marginLeft + 2, buyerY + 6)
    doc.setFont('helvetica', 'normal')
    doc.text(companySettings?.name || '', marginLeft + 2, buyerY + 12)

    const buyerAddress = doc.splitTextToSize(companySettings?.address || '', col1Width - 4)
    doc.text(buyerAddress, marginLeft + 2, buyerY + 18)

    let nextY = buyerY + 18 + (buyerAddress.length * 5)
    doc.text(`Tel: ${companySettings?.telephone || ''}`, marginLeft + 2, nextY)
    doc.text(`Fax: ${companySettings?.fax || ''}`, marginLeft + 2, nextY + 6)
    doc.text(`NTN: ${companySettings?.ntn || ''}`, marginLeft + 2, nextY + 12)


    // --- Items Table ---
    const tableStartY = rightColumnBottom + 5

    // Calculate available height for table
    // Page Height (297) - Bottom Margin (10) - Footer (45) - Totals (approx 24) - Table Start
    const totalsHeight = po.tax_amount > 0 ? 24 : 18
    const footerHeight = 35 // Increased to leave more space for signatures
    const bottomMargin = 20
    const availableHeight = 297 - bottomMargin - footerHeight - totalsHeight - tableStartY

    // Calculate max rows that fit
    // Assuming row height is approx 8-10mm (fontSize 11 + padding)
    const estimatedRowHeight = 8.5
    const maxRows = Math.floor(availableHeight / estimatedRowHeight)
    // Ensure at least some rows
    const minRows = Math.max(maxRows, 5)

    const tableColumn = ["Sr. No", "Description of Goods", "Quantity", "Unit Price", "Total Amount (Rs.)"]
    const tableRows: any[] = []

    let calculatedSubTotal = 0

    if (po.items) {
        po.items.forEach((item: any, index: number) => {
            // Use line_total from DB which follows the user's formula:
            // IF(KGs == 0, Rate * Quantity, Rate * KGs)
            const total = item.line_total || 0
            calculatedSubTotal += total

            let description = item.product_description || item.manual_product_name || item.product_id
            // Add Weight if available (Paper & Board)
            if (item.calculated_kgs && Number(item.calculated_kgs) > 0) {
                description += ` [${Number(item.calculated_kgs).toFixed(2)} Kg]`
            }

            const poData = [
                index + 1,
                description,
                `${formatNumber(item.quantity)} ${item.uom || ''}`,
                formatCurrency(item.rate),
                formatCurrency(total)
            ]
            tableRows.push(poData)
        })
    }

    // Fill remaining space with empty rows
    while (tableRows.length < minRows) {
        tableRows.push(['', '', '', '', ''])
    }

    autoTable(doc, {
        startY: tableStartY,
        head: [tableColumn],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineWidth: 0.1, lineColor: [0, 0, 0], fontSize: 11 },
        styles: { lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0], fontSize: 11, cellPadding: 1.5, minCellHeight: 8 },
        margin: { left: marginLeft, right: marginLeft },
        tableWidth: contentWidth,
        columnStyles: {
            0: { halign: 'center', cellWidth: 15 },
            1: { cellWidth: 'auto' },
            2: { halign: 'center', cellWidth: 25 },
            3: { halign: 'center', cellWidth: 25 },
            4: { halign: 'right', cellWidth: 35 }
        }
    })

    // --- Footer & Totals ---
    const finalY = (doc as any).lastAutoTable.finalY + 5

    // Totals Box
    const totalsBoxX = marginLeft + contentWidth - 60
    const totalsBoxWidth = 60

    // Subtotal
    doc.setFont('helvetica', 'bold')
    doc.text('Sub Total:', totalsBoxX, finalY + 5)
    doc.setFont('helvetica', 'normal')
    doc.text(formatCurrency(calculatedSubTotal), totalsBoxX + 55, finalY + 5, { align: 'right' })

    let currentTotalY = finalY + 5

    // Tax (if applicable)
    if (po.tax_amount > 0) {
        currentTotalY += 6
        doc.setFont('helvetica', 'bold')
        doc.text(`Sales Tax (${po.tax_rate}%):`, totalsBoxX, currentTotalY)
        doc.setFont('helvetica', 'normal')
        doc.text(formatCurrency(po.tax_amount), totalsBoxX + 55, currentTotalY, { align: 'right' })
    }

    // Freight (if applicable)
    if (po.freight_amount > 0) {
        currentTotalY += 6
        doc.setFont('helvetica', 'bold')
        doc.text('Freight:', totalsBoxX, currentTotalY)
        doc.setFont('helvetica', 'normal')
        doc.text(formatCurrency(po.freight_amount), totalsBoxX + 55, currentTotalY, { align: 'right' })
    }

    // Grand Total
    currentTotalY += 8
    doc.setFont('helvetica', 'bold')
    doc.text('Grand Total:', totalsBoxX, currentTotalY)
    doc.text(formatCurrency(calculatedSubTotal + (po.tax_amount || 0) + (po.freight_amount || 0)), totalsBoxX + 55, currentTotalY, { align: 'right' })

    if (po.sheet_size_mismatch) {
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(200, 0, 0)
        doc.text('* NOTE: Sheet size mismatch detected (differs from Job Card). PO requires verification/approval.', marginLeft, 270)
        doc.setTextColor(0, 0, 0)
    }

    // Signatures
    const signatureY = 280 // Moved down to add space between totals and signatures
    doc.line(marginLeft, signatureY, marginLeft + 50, signatureY)
    doc.text('Prepared By', marginLeft + 10, signatureY + 5)

    doc.line(marginLeft + 70, signatureY, marginLeft + 120, signatureY)
    doc.text('Checked By', marginLeft + 80, signatureY + 5)

    doc.line(marginLeft + 140, signatureY, marginLeft + 190, signatureY)
    doc.text('Approved By', marginLeft + 150, signatureY + 5)

    // Handle Output Mode
    if (mode === 'save') {
        doc.save(`${title}_${po.order_no || po.id}.pdf`)
    } else if (mode === 'blob') {
        return doc.output('blob') // Return blob for iframe printing
    } else if (mode === 'datauristring') {
        return doc.output('datauristring') // Added for main process printing
    } else {
        doc.autoPrint()
        window.open(doc.output('bloburl'), '_blank')
    }
}

// Updated type definition to include 'blob' and 'datauristring'
export const generateDeliveryNote = async (
    po: any,
    companySettings: any,
    mode: 'save' | 'print' | 'blob' | 'datauristring' = 'save',
    user: any = null // Added user argument
) => {
    // ==========================================================
    // MODE 1: SIMPLE FORMAT (No Sales Tax)
    // ==========================================================
    if (!po.has_sales_tax) {
        const doc = new jsPDF()

        // --- Header ---
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.text("Delivery Note", 105, 20, { align: 'center' })

        doc.setLineWidth(0.5)
        doc.line(10, 25, 200, 25) // Top Line

        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')

        // Left Info
        let leftY = 35
        const lineSpacing = 10;

        // Centering Logic
        // Page Width ~210. Margins 10. Content 190. Mid 105.
        // Left Block: 15 to 100 (W=85). Right Block: 110 to 195 (W=85).

        const leftXLabel = 15;
        const leftXValue = 40;
        const leftLineEnd = 100;

        const rightXLabel = 110; // Symmetric to Left
        const rightXValue = 135;
        const rightLineEnd = 195;

        doc.text("Date:", leftXLabel, leftY)
        doc.text(formatDate(po.date), leftXValue, leftY)
        doc.line(leftXLabel, leftY + 1, leftLineEnd, leftY + 1)

        leftY += lineSpacing
        doc.text("P.O. no.", leftXLabel, leftY)
        doc.text(po.linked_po_id || '-', leftXValue, leftY)
        doc.line(leftXLabel, leftY + 1, leftLineEnd, leftY + 1)

        leftY += lineSpacing
        doc.text("Customer:", leftXLabel, leftY)
        doc.text(po.supplier_name || '-', leftXValue, leftY)
        doc.line(leftXLabel, leftY + 1, leftLineEnd, leftY + 1)

        // Right Info
        let rightY = 35
        doc.text("Vehicle No.:", rightXLabel, rightY)
        doc.text(po.vehicle_no || '-', rightXValue, rightY)
        doc.line(rightXLabel, rightY + 1, rightLineEnd, rightY + 1)

        rightY += lineSpacing
        doc.text("Driver Name:", rightXLabel, rightY)
        doc.text(po.driver_name || '-', rightXValue, rightY)
        doc.line(rightXLabel, rightY + 1, rightLineEnd, rightY + 1)

        rightY += lineSpacing
        doc.text("OGP No.", rightXLabel, rightY)
        doc.text(po.ogp_no || '-', rightXValue, rightY)
        doc.line(rightXLabel, rightY + 1, rightLineEnd, rightY + 1)


        // --- Table ---
        const tableStartY = 70 // Moved down due to increased header spacing
        const tableColumn = ["Sr. No.", "Detail's", "No. Of Ctn", "Packing Size", "Total Qty"]
        const tableRows: any[] = []

        let totalQty = 0
        let totalBoxes = 0

        if (po.items) {
            po.items.forEach((item: any, index: number) => {
                const stdBoxes = Number(item.no_of_boxes || 0);
                const stdQtyPerBox = Number(item.qty_per_box || 0);
                const stdTotalQty = stdBoxes * stdQtyPerBox;

                totalBoxes += stdBoxes;

                let desc = item.product_description || item.manual_product_name || item.product_id
                const code = item.item_code || ''
                const detailText = code ? `${desc}\nITEM CODE: ${code}` : desc

                tableRows.push([
                    index + 1,
                    detailText,
                    stdBoxes || '-',
                    formatNumber(stdQtyPerBox),
                    formatNumber(stdTotalQty)
                ])

                if (item.has_short_item && Number(item.short_no_of_boxes) > 0) {
                    const shortBoxes = Number(item.short_no_of_boxes || 0);
                    const shortQtyPerBox = Number(item.short_qty_per_box || 0);
                    const shortTotalQty = shortBoxes * shortQtyPerBox;

                    totalBoxes += shortBoxes;

                    tableRows.push([
                        '', // Sr No Empty
                        '', // Details Empty
                        shortBoxes,
                        formatNumber(shortQtyPerBox),
                        formatNumber(shortTotalQty)
                    ]);
                }

                // Ensure Grand Total Qty matches the sum of all rows
                // stdTotalQty + shortTotalQty should equal item.quantity (if synced correctly in POCreate)
                // We'll trust the calculated values for the rows, so the PDF sums up visually.
                totalQty += stdTotalQty + ((item.has_short_item && Number(item.short_no_of_boxes) > 0) ? (Number(item.short_no_of_boxes) * Number(item.short_qty_per_box)) : 0);
            })
        }

        // Minimum empty rows
        while (tableRows.length < 15) {
            tableRows.push(['', '', '', '', ''])
        }

        // Add Total Row
        tableRows.push([
            { content: '' }, // Empty Sr No - Border restored
            { content: 'Total Quantity', styles: { fontStyle: 'bold', halign: 'right' } }, // Details Column -> Label
            { content: formatNumber(totalBoxes), styles: { fontStyle: 'bold', halign: 'center' } }, // Total Boxes -> Col 2
            { content: '' }, // Empty Packing Size column - Border restored
            { content: formatNumber(totalQty), styles: { fontStyle: 'bold', halign: 'right' } } // Total Qty -> Col 4
        ])


        autoTable(doc, {
            startY: tableStartY,
            head: [tableColumn],
            body: tableRows,
            theme: 'plain', // Clean look
            styles: {
                lineColor: [0, 0, 0],
                lineWidth: 0.2, // Thin borders
                textColor: [0, 0, 0],
                fontSize: 10,
                cellPadding: 3,
                valign: 'top', // Align top for multiline details
            },
            headStyles: {
                fillColor: [220, 220, 220],
                textColor: [0, 0, 0],
                fontStyle: 'bold',
                halign: 'center',
                lineWidth: 0.2,
                lineColor: [0, 0, 0]
            },
            columnStyles: {
                0: { halign: 'center', cellWidth: 15 }, // Sr No
                1: { cellWidth: 'auto' }, // Details (auto expand)
                2: { halign: 'center', cellWidth: 25 }, // No Of Ctn
                3: { halign: 'center', cellWidth: 30 }, // Packing Size
                4: { halign: 'right', cellWidth: 30 } // Total Qty
            },
            // Custom hook to fix the footer borders or specific styling if needed
            didParseCell: (data) => {
                // Check if it's the last row (Total) to handle borders if needed
                // autoTable handles "plain" theme with borders if lineWidth is set in styles
                if (data.row.index === tableRows.length - 1) {
                    // Total Row Styling
                    data.cell.styles.fillColor = [240, 240, 240];
                }
            }
        })

        // --- Signatures ---
        const finalY = (doc as any).lastAutoTable.finalY + 30

        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')

        // Prepared by
        doc.text("Prepared by:", 20, finalY)
        // Draw line/signature path
        // Using an image path if provided in chat? No, just placeholder lines matching image
        // Image has a signature. We just need the placeholder text.
        // Image shows a generated signature maybe? Or just a line.
        // Let's add a line.
        doc.line(20, finalY + 15, 80, finalY + 15)


        // Received by
        doc.text("Received by:", 140, finalY)
        doc.line(140, finalY + 15, 200, finalY + 15)


        // Handle Output Mode
        if (mode === 'save') {
            doc.save(`DeliveryNote_PO-${po.linked_po_id || po.id}.pdf`)
        } else if (mode === 'blob') {
            return doc.output('blob')
        } else if (mode === 'datauristring') {
            return doc.output('datauristring')
        } else {
            doc.autoPrint()
            window.open(doc.output('bloburl'), '_blank')
        }
        return;
    }

    // ==========================================================
    // MODE 2: OFFICIAL FORMAT (Sales Tax Checked)
    // ==========================================================

    // ... Copy of existing 'generateDeliveryNote' logic ...
    const doc = new jsPDF()

    // --- Header ---
    const marginLeft = 10
    const marginRight = 10
    const pageWidth = 210
    const contentWidth = pageWidth - marginLeft - marginRight
    const topY = 10

    // Main Border
    doc.setLineWidth(0.3)
    doc.rect(marginLeft, topY, contentWidth, 277)

    // Header Section
    const headerHeight = 25
    doc.line(marginLeft, topY + headerHeight, marginLeft + contentWidth, topY + headerHeight)

    const logoWidth = 40
    doc.line(marginLeft + logoWidth, topY, marginLeft + logoWidth, topY + headerHeight)

    const docInfoWidth = 40
    const docInfoX = marginLeft + contentWidth - docInfoWidth
    doc.line(docInfoX, topY, docInfoX, topY + headerHeight)

    if (companySettings?.logo_path) {
        try {
            doc.addImage(companySettings.logo_path, 'PNG', marginLeft + 2, topY + 2, 36, 21)
        } catch (e) {
            console.error('Failed to add logo', e)
        }
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22) // Increased from 16
    const centerBoxWidth = contentWidth - logoWidth - docInfoWidth
    const centerBoxX = marginLeft + logoWidth
    doc.text(companySettings?.name || 'COMPANY NAME', centerBoxX + (centerBoxWidth / 2), topY + 15, { align: 'center' })

    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')

    const rowH = headerHeight / 3
    doc.line(docInfoX, topY + rowH, marginLeft + contentWidth, topY + rowH)
    doc.line(docInfoX, topY + (rowH * 2), marginLeft + contentWidth, topY + (rowH * 2))

    const docInfoCenter = docInfoX + (docInfoWidth / 2)
    doc.line(docInfoCenter, topY, docInfoCenter, topY + headerHeight)

    doc.text('ISSUE NO.', docInfoX + 1, topY + 5)
    doc.text('2', docInfoCenter + 1, topY + 5)

    doc.text('DOC NO.', docInfoX + 1, topY + 5 + rowH)
    doc.text('ECP/STR/F-04', docInfoCenter + 1, topY + 5 + rowH)

    doc.text('REV DATE', docInfoX + 1, topY + 5 + (rowH * 2))
    doc.text('01-01-25', docInfoCenter + 1, topY + 5 + (rowH * 2))

    const titleY = topY + headerHeight
    const titleHeight = 10
    doc.line(marginLeft, titleY + titleHeight, marginLeft + contentWidth, titleY + titleHeight)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setFillColor(220, 220, 220)
    doc.rect(marginLeft, titleY, contentWidth, titleHeight, 'F')
    doc.text('DELIVERY NOTE', pageWidth / 2, titleY + 7, { align: 'center' })

    // --- Details Section ---
    const detailsY = titleY + titleHeight
    const detailsHeight = 60
    const leftColWidth = contentWidth * 0.55
    const midX = marginLeft + leftColWidth

    doc.line(midX, detailsY, midX, detailsY + detailsHeight)
    doc.line(marginLeft, detailsY + detailsHeight, marginLeft + contentWidth, detailsY + detailsHeight)

    const sellerHeight = detailsHeight / 2
    doc.line(marginLeft, detailsY + sellerHeight, midX, detailsY + sellerHeight)

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('SELLER:', marginLeft + 2, detailsY + 5)

    doc.setFontSize(10)
    doc.text(companySettings?.name || 'Seller Company', marginLeft + 2, detailsY + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const sellerAddress = doc.splitTextToSize(companySettings?.address || '', leftColWidth - 4)
    doc.text(sellerAddress, marginLeft + 2, detailsY + 17)

    const buyerY = detailsY + sellerHeight
    doc.setFont('helvetica', 'bold')
    doc.text('BUYER:', marginLeft + 2, buyerY + 5)

    doc.setFontSize(10)
    doc.text(po.supplier_name || 'Buyer Name', marginLeft + 2, buyerY + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)

    // Buyer Address
    const buyerAddressWidth = leftColWidth - 4
    const buyerAddressLines = doc.splitTextToSize(po.supplier_address || '', buyerAddressWidth)
    doc.text(buyerAddressLines, marginLeft + 2, buyerY + 17)

    const rightRows = 8
    const rightRowH = detailsHeight / rightRows

    const labels = [
        'DATE:', 'DELIVERY ORDER NO:', 'P.O. NO:', 'VEHICLE NO:',
        'DRIVER NAME:', "DRIVER'S MOBILE:", 'SHIPMENT DESTINATION:', 'OGP NO:'
    ]
    const values = [
        formatDate(po.date),
        po.order_no || po.id,
        po.linked_po_id ? `${po.linked_po_id}` : '-',
        po.vehicle_no || '-',
        po.driver_name || '-',
        po.driver_mobile || '-',
        po.destination || '-',
        po.ogp_no || '-'
    ]

    doc.setFontSize(9)
    for (let i = 0; i < rightRows; i++) {
        const y = detailsY + (i * rightRowH)
        doc.line(midX, y + rightRowH, marginLeft + contentWidth, y + rightRowH)
        doc.line(midX + 45, y, midX + 45, y + rightRowH)

        doc.setFont('helvetica', 'bold')
        doc.text(labels[i], midX + 2, y + 5)

        doc.setFont('helvetica', 'normal')
        doc.text(String(values[i]), midX + 47, y + 5)
    }

    // --- Table Section ---
    const tableY = detailsY + detailsHeight
    const tableColumn = ["SR NO.", "DESCRIPTION OF GOODS", "NO OF BOXES", "QTY PER BOX", "TOTAL QTY"]
    const tableRows: any[] = []

    let totalQty = 0
    let totalBoxes = 0

    if (po.items) {
        po.items.forEach((item: any, index: number) => {
            const stdBoxes = Number(item.no_of_boxes || 0);
            const stdQtyPerBox = Number(item.qty_per_box || 0);
            const stdTotalQty = stdBoxes * stdQtyPerBox;

            totalBoxes += stdBoxes;

            let description = item.product_description || item.manual_product_name || item.product_id
            const code = item.item_code || ''

            if (code) {
                tableRows.push([
                    { content: index + 1, rowSpan: 2 },
                    { content: description, styles: { cellPadding: { top: 2, right: 2, bottom: 0, left: 2 } } },
                    { content: stdBoxes || '-', rowSpan: 2 },
                    { content: formatNumber(stdQtyPerBox), rowSpan: 2 },
                    { content: formatNumber(stdTotalQty), rowSpan: 2 }
                ])
                tableRows.push([
                    { content: `ITEM CODE: ${code}`, styles: { fontSize: 7, textColor: [80, 80, 80], cellPadding: { top: 0, right: 2, bottom: 2, left: 2 } } }
                ])
            } else {
                tableRows.push([
                    index + 1,
                    description,
                    stdBoxes || '-',
                    formatNumber(stdQtyPerBox),
                    formatNumber(stdTotalQty)
                ])
            }

            if (item.has_short_item && Number(item.short_no_of_boxes) > 0) {
                const shortBoxes = Number(item.short_no_of_boxes || 0);
                const shortQtyPerBox = Number(item.short_qty_per_box || 0);
                const shortTotalQty = shortBoxes * shortQtyPerBox;

                totalBoxes += shortBoxes;

                tableRows.push([
                    '', // SR NO
                    '', // DESCRIPTION OF GOODS
                    shortBoxes,
                    formatNumber(shortQtyPerBox),
                    formatNumber(shortTotalQty)
                ]);
            }

            // Ensure Grand Total Qty matches the sum of all rows
            // We use the calculated values to ensure the visual sum matches the total
            const shortTotalQty = (item.has_short_item && Number(item.short_no_of_boxes) > 0) ? (Number(item.short_no_of_boxes) * Number(item.short_qty_per_box)) : 0;
            totalQty += stdTotalQty + shortTotalQty;
        })
    }

    const minTableRows = 13 // Increased from 10 to fill empty space
    while (tableRows.length < minTableRows) {
        tableRows.push(['', '', '', '', ''])
    }

    autoTable(doc, {
        startY: tableY,
        head: [tableColumn],
        body: tableRows,
        theme: 'plain',
        headStyles: {
            fillColor: [220, 220, 220],
            textColor: [0, 0, 0],
            lineWidth: 0.3,
            lineColor: [0, 0, 0],
            fontSize: 9,
            halign: 'center',
            valign: 'middle'
        },
        styles: {
            lineColor: [0, 0, 0],
            lineWidth: 0.3,
            textColor: [0, 0, 0],
            fontSize: 9,
            cellPadding: 2,
            minCellHeight: 10,
            valign: 'middle'
        },
        margin: { left: marginLeft, right: marginRight },
        tableWidth: contentWidth,
        columnStyles: {
            0: { halign: 'center', cellWidth: 15 },
            1: { halign: 'left' },
            2: { halign: 'center', cellWidth: 25 },
            3: { halign: 'center', cellWidth: 25 },
            4: { halign: 'right', cellWidth: 30 }
        }
    })

    const finalY = (doc as any).lastAutoTable.finalY

    doc.setFont('helvetica', 'bold')
    doc.rect(marginLeft, finalY, contentWidth, 10)

    const col0W = 15
    const col1W = contentWidth - 15 - 25 - 25 - 30
    const col2W = 25
    const col3W = 25
    const col4W = 30

    const x1 = marginLeft + col0W + col1W
    const x2 = x1 + col2W
    const x3 = x2 + col3W

    doc.line(x1, finalY, x1, finalY + 10)
    doc.line(x2, finalY, x2, finalY + 10)
    doc.line(x3, finalY, x3, finalY + 10)

    doc.text('TOTAL QUANTITY', marginLeft + 5, finalY + 7)
    doc.text(String(totalBoxes), x1 + (col2W / 2), finalY + 7, { align: 'center' })
    doc.text(formatNumber(totalQty), marginLeft + contentWidth - 2, finalY + 7, { align: 'right' })

    // Signature Section - simplified (No boxes)
    const sigY = finalY + 10
    // contentWidth is already in scope 


    const sigHeight = 35; // Defined height

    // Draw Box and Vertical Dividers
    doc.rect(marginLeft, sigY, contentWidth, sigHeight)

    // Calculate column centers for text alignment
    const boxW = contentWidth / 3

    // Vertical Dividers
    doc.line(marginLeft + boxW, sigY, marginLeft + boxW, sigY + sigHeight)
    doc.line(marginLeft + (boxW * 2), sigY, marginLeft + (boxW * 2), sigY + sigHeight)


    doc.setFontSize(8)
    doc.text('PREPARED BY', marginLeft + (boxW / 2), sigY + 5, { align: 'center' })

    // Display User Name if available
    if (user && (user.username || user.display_name)) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        doc.text(user.display_name || user.username, marginLeft + (boxW / 2), sigY + 20, { align: 'center' })
        doc.setFontSize(8)
        doc.setFont('helvetica', 'bold')
    }

    doc.text('CHECKED BY', marginLeft + boxW + (boxW / 2), sigY + 5, { align: 'center' }) // Changed from CHARGE to CHECKED BY
    doc.text('RECEIVED BY', marginLeft + (boxW * 2) + (boxW / 2), sigY + 5, { align: 'center' })
    doc.text('(Customer\'s Signature & Stamp)', marginLeft + (boxW * 2) + (boxW / 2), sigY + 25, { align: 'center' })

    // Handle Output Mode
    if (mode === 'save') {
        doc.save(`DeliveryNote_${po.order_no || po.id}.pdf`)
    } else if (mode === 'blob') {
        return doc.output('blob')
    } else if (mode === 'datauristring') {
        return doc.output('datauristring')
    } else {
        doc.autoPrint()
        window.open(doc.output('bloburl'), '_blank')
    }
}

export const generateJobCardPdf = async (
    jobCard: any,
    companySettings: any,
    mode: 'save' | 'print' | 'blob' | 'datauristring' = 'save',
    linkedPOs: any[] = [] // Added linkedPOs argument
) => {
    const doc = new jsPDF()
    const marginLeft = 14
    const contentWidth = 182
    const pageWidth = 210

    // Header Logo
    if (companySettings?.logo_path) {
        try {
            doc.addImage(companySettings.logo_path, 'PNG', pageWidth / 2 - 20, 10, 40, 15)
        } catch (e) {
            console.error('Failed to add logo', e)
        }
    }

    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('JOB TRACK REPORT', pageWidth / 2, 35, { align: 'center' })
    doc.line(marginLeft, 38, marginLeft + contentWidth, 38)
    doc.line(marginLeft, 39, marginLeft + contentWidth, 39)

    // Job Info Table - Equal Sizes (33% each column group)
    autoTable(doc, {
        startY: 45,
        body: [
            [
                { content: 'Job Card Date', styles: { fontStyle: 'bold', halign: 'center' } }, { content: jobCard.jobCardDate, styles: { halign: 'center' } },
                { content: 'Job Card No.', styles: { fontStyle: 'bold', halign: 'center' } }, { content: jobCard.jobCardNo, styles: { halign: 'center' } },
                { content: 'Target Date', styles: { fontStyle: 'bold', halign: 'center' } }, { content: jobCard.targetDate || '-', styles: { halign: 'center' } }
            ]
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
        columnStyles: {
            0: { cellWidth: 30 }, 1: { cellWidth: 30.6 },
            2: { cellWidth: 30 }, 3: { cellWidth: 30.6 },
            4: { cellWidth: 30 }, 5: { cellWidth: 30.6 }
        }
    })

    // Customer Data
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 5,
        head: [[{ content: 'CUSTOMER DATA', colSpan: 6, styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: [
            [
                { content: 'Customer Name', styles: { fontStyle: 'bold' } }, { content: jobCard.customerData?.customerName || '-', colSpan: 2 },
                { content: 'Job Name', styles: { fontStyle: 'bold' } }, { content: jobCard.customerData?.jobName || '-', colSpan: 2 }
            ],
            [
                { content: 'PO Date', styles: { fontStyle: 'bold' } }, jobCard.customerData?.poDate || '-',
                { content: 'PO Quantity', styles: { fontStyle: 'bold' } }, jobCard.customerData?.poQuantity || '-',
                { content: 'P.O. No.', styles: { fontStyle: 'bold' } }, jobCard.customerData?.poNo || '-'
            ],
            [
                { content: 'Tolerance (Qty)', styles: { fontStyle: 'bold' } }, { content: jobCard.customerData?.tolerance || '-', colSpan: 5 }
            ],
            ...(jobCard.customerData?.variants && jobCard.customerData.variants.length > 0 ? (
                jobCard.customerData.variants.map((v: any, idx: number) => [
                    { content: `Variant ${jobCard.customerData.variants.length > 1 ? idx + 1 : ''}`, styles: { fontStyle: 'bold' as any } }, { content: v.name || '-', colSpan: 2 },
                    { content: 'Quantity', styles: { fontStyle: 'bold' as any } }, { content: v.quantity || v.qty || '-', colSpan: 2 }
                ])
            ) : (
                [[
                    { content: 'Variant', styles: { fontStyle: 'bold' as any } }, { content: jobCard.customerData?.variant || '-', colSpan: 2 },
                    { content: 'Quantity', styles: { fontStyle: 'bold' as any } }, { content: jobCard.customerData?.quantity || '-', colSpan: 2 }
                ]]
            ))
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
        columnStyles: {
            0: { cellWidth: 30 }, 1: { cellWidth: 30.6 }, 2: { cellWidth: 30 },
            3: { cellWidth: 30.6 }, 4: { cellWidth: 30 }, 5: { cellWidth: 30.6 }
        }
    })

    // Requirements
    const categoryName = jobCard.requirements?.categoryName || 'Catalogue'
    const isCatalogue = categoryName === 'Catalogue'

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 5,
        head: [
            [{ content: `Requirements (For ${categoryName})`.toUpperCase(), colSpan: isCatalogue ? 4 : 2, styles: { halign: 'center', fillColor: [240, 240, 240], fontStyle: 'bold' as any } }],
            isCatalogue ? [
                { content: 'Title Page', colSpan: 2, styles: { halign: 'center', fillColor: [245, 245, 245], fontStyle: 'bold' as any } },
                { content: 'Inner Pages', colSpan: 2, styles: { halign: 'center', fillColor: [245, 245, 245], fontStyle: 'bold' as any } }
            ] : []
        ].filter(h => h.length > 0) as any,
        body: [
            ['GSM', 'gsm'], ['Material Type', 'materialType'], ['Printing', 'printingType'], ['No. of Colours', 'noOfColours'],
            ['Lamination', 'lamination'], ['Coating', 'coating'], ['Texture', 'texture'],
            ['UV / Drip off', 'uvDripOff'], ['Embossing', 'embossing'], ['Foiling', 'foiling'], ['Binding', 'binding']
        ].map(([label, key]) => {
            const titleValue = jobCard.requirements?.titlePage?.[key];
            const innerValue = jobCard.requirements?.innerPages?.[key];
            if (isCatalogue) {
                return [
                    { content: label, styles: { fontStyle: 'bold' as any, fillColor: [250, 250, 250] } },
                    { content: titleValue || '-' },
                    { content: label, styles: { fontStyle: 'bold' as any, fillColor: [250, 250, 250] } },
                    { content: innerValue || '-' }
                ]
            } else {
                return [
                    { content: label, styles: { fontStyle: 'bold' as any, fillColor: [250, 250, 250] } },
                    { content: titleValue || '-' }
                ]
            }
        }),
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
        columnStyles: isCatalogue ? {
            0: { cellWidth: contentWidth * 0.25, fontStyle: 'bold' as any, fillColor: [245, 245, 245] },
            1: { cellWidth: contentWidth * 0.25 },
            2: { cellWidth: contentWidth * 0.25, fontStyle: 'bold' as any, fillColor: [245, 245, 245], lineWidth: { left: 0.5 } as any },
            3: { cellWidth: contentWidth * 0.25 }
        } : {
            0: { cellWidth: contentWidth * 0.5, fontStyle: 'bold' as any, fillColor: [245, 245, 245] },
            1: { cellWidth: contentWidth * 0.5 }
        }
    })

    // Other Specifications
    if (jobCard.otherSpecs) {
        autoTable(doc, {
            startY: (doc as any).lastAutoTable.finalY + 2,
            head: [[{ content: 'OTHER SPECIFICATIONS', styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
            body: [[jobCard.otherSpecs]],
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 }
        })
    }

    // Pre Press
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 5,
        head: [[{ content: 'PRE PRESS', colSpan: 4, styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: [
            ['Plates', jobCard.phase2Data?.plates || '-', 'Pos. UV', jobCard.phase2Data?.positiveUV || '-'],
            ['Pos. Die', jobCard.phase2Data?.positiveDie || '-', 'Pos. Foil', jobCard.phase2Data?.positiveFoil || '-'],
            ['Emboss. Pos.', jobCard.phase2Data?.embossingBlackPositive || '-', 'Shade Card', jobCard.phase2Data?.shadeCard || '-'],
            ['Ups', jobCard.phase2Data?.ups || '-', 'Sheet Size', (jobCard.phase2Data?.sheetSizeL != null && jobCard.phase2Data?.sheetSizeL !== '' && jobCard.phase2Data?.sheetSizeL !== 0) || (jobCard.phase2Data?.sheetSizeW != null && jobCard.phase2Data?.sheetSizeW !== '' && jobCard.phase2Data?.sheetSizeW !== 0) ? `L: ${jobCard.phase2Data?.sheetSizeL || '-'} W: ${jobCard.phase2Data?.sheetSizeW || '-'} GSM: ${jobCard.phase2Data?.sheetSizeGsm || '-'}` : (jobCard.phase2Data?.sheetSize || '-')],
            ['Finished Size', jobCard.phase2Data?.finishedSize || '-', 'Pages', jobCard.phase2Data?.numberOfPages || '-'],
            ['Digital Dummy', jobCard.phase2Data?.digitalDummy || '-', '', '']
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: contentWidth * 0.25, fontStyle: 'bold' as any, fillColor: [245, 245, 245] },
            1: { cellWidth: contentWidth * 0.25 },
            2: { cellWidth: contentWidth * 0.25, fontStyle: 'bold' as any, fillColor: [245, 245, 245] },
            3: { cellWidth: contentWidth * 0.25 }
        }
    })

    // Page Break after Pre Press as requested
    doc.addPage()

    // Procurement
    const procurementRows: any[] = [];
    if (linkedPOs && linkedPOs.length > 0) {
        linkedPOs.forEach(po => {
            (po.items || [])
                .filter((item: any) => item.category?.toUpperCase() === 'PAPER & BOARD')
                .forEach((item: any) => {
                    procurementRows.push([
                        po.order_no || po.id,
                        item.product_description || item.product_id,
                        item.length && item.width ? `${item.length}" x ${item.width}"` : '-',
                        item.gsm || '-',
                        item.quantity || '-'
                    ]);
                });
        });
    }

    autoTable(doc, {
        startY: 20,
        head: [[{ content: 'PROCUREMENT', colSpan: 5, styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: procurementRows.length > 0 ? [
            [
                { content: 'PO Number', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'Material Type', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'Material Size', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'GSM', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'No. of Sheets', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } }
            ],
            ...procurementRows
        ] : [
            [{ content: 'No linked procurement data', colSpan: 5, styles: { halign: 'center', fontStyle: 'italic' as any, textColor: [150, 150, 150] } }]
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 25 },
            3: { cellWidth: 20 },
            4: { cellWidth: 25 }
        }
    })

    // Store (RM Issue) - New Phase 4
    const storeRows = (jobCard.phase4Data?.storeLogs || []).map((log: any) => [
        log.date || '-',
        log.grn_no || '-',
        log.transaction_type || '-',
        log.product_name || '-',
        log.quantity || '-'
    ]);

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 5,
        head: [[{ content: 'STORE (RM ISSUE)', colSpan: 5, styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: storeRows.length > 0 ? [
            [
                { content: 'Date', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'GRN No', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'Type', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'Product', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } },
                { content: 'Quantity', styles: { fontStyle: 'bold' as any, fillColor: [245, 245, 245] } }
            ],
            ...storeRows
        ] : [
            [{ content: 'No inventory entries recorded', colSpan: 5, styles: { halign: 'center', fontStyle: 'italic' as any, textColor: [150, 150, 150] } }]
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 30 },
            2: { cellWidth: 25 },
            3: { cellWidth: 'auto' },
            4: { cellWidth: 25 }
        }
    })

    // Production Logs - Phase 5
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 5,
        head: [[{ content: 'PRODUCTION LOGS', colSpan: 8, styles: { halign: 'center', fillColor: [220, 240, 255], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: [
            ['Start', 'End', 'Machine', 'Shift', 'Operator', 'Sheets', 'Prod', 'Waste'],
            ...(jobCard.phase5Data?.productionLogs || []).map((log: any) => [
                log.startTime, log.endTime, log.machine, log.shift, log.operator, log.assignedSheets || '-', log.productionQty, log.waste
            ])
        ],
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1, halign: 'center', textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 },
        headStyles: { fontStyle: 'bold', textColor: [0, 0, 0] }
    })

    // QC Logs - Phase 6
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 5,
        head: [[{ content: 'QUALITY CHECK LOGS', colSpan: 8, styles: { halign: 'center', fillColor: [220, 255, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: [
            ['UV', 'Printing', 'Die Cut', 'Lamination', 'FG', 'Binding', 'Packing', 'Att.'],
            ...(jobCard.phase6Data?.qcLogs || []).map((log: any) => [
                log.uv || '-', log.printing || '-', log.dieCutting || '-', log.lamination || '-', log.fg || '-', log.binding || '-', log.packing || '-', log.fileUrl ? 'YES' : 'NO'
            ])
        ],
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1, halign: 'center', textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 },
        headStyles: { fontStyle: 'bold', textColor: [0, 0, 0] }
    })

    // Delivery Status - Phase 7
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 2,
        head: [[{ content: 'DELIVERY STATUS', colSpan: 4, styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: jobCard.phase7Data?.deliveryLogs?.length > 0 ? [
            ['FG Received', 'Delivery Date', 'Challan No.', 'Qty'],
            ...jobCard.phase7Data.deliveryLogs.map((log: any) => [
                log.fgReceived ? 'YES' : 'NO',
                log.deliveryDate || '-',
                log.deliveryChallanNo || '-',
                log.deliveredQty || '-'
            ])
        ] : [
            [`No delivery logs recorded`]
        ],
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, halign: 'center' as any, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 }
    })

    // Waste Monitoring - Phase 8
    const totalActualWastage = (jobCard.phase5Data?.productionLogs || []).reduce((sum: number, log: any) => sum + Number(log.waste || 0), 0);
    const allowedWastage = Number(jobCard.phase5Data?.allowedWastage || 0);
    const excessWastage = Math.max(0, totalActualWastage - allowedWastage);

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 5,
        head: [[{ content: 'WASTE MONITORING & ROOT CAUSE', colSpan: 2, styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: [
            [
                { content: `Allowed Wastage: ${allowedWastage}`, styles: { fontStyle: 'bold' as any } },
                { content: `Actual Wastage: ${totalActualWastage}`, styles: { fontStyle: 'bold' as any, textColor: [0, 0, 0] } }
            ],
            [
                { content: `Excess Wastage: ${excessWastage}`, styles: { fontStyle: 'bold' as any, textColor: excessWastage > 0 ? [200, 0, 0] : [0, 0, 0] }, colSpan: 2 }
            ],
            ...(excessWastage > 0 ? [
                [{ content: `Root Cause: ${jobCard.phase8Data?.rootCause || '-'}`, colSpan: 2, styles: { cellPadding: 3 } }]
            ] : []),
            [
                { content: `Actual Waste %: ${jobCard.phase8Data?.actualWastePercent || '-'}%`, styles: { fontSize: 8 } },
                { content: `Excess Waste %: ${jobCard.phase8Data?.excessWastePercent || '-'}%`, styles: { fontSize: 8 } }
            ]
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 }
    })

    // Signatures
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [[{ content: 'SIGNATURES', colSpan: 8, styles: { halign: 'center', fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as any } }]],
        body: [
            ['Marketing', 'Pre Press', 'Proc', 'Store', 'Prod', 'QC', 'Dispatch', 'Head'],
            [
                jobCard.phaseStatuses?.[1] === 'completed' ? 'SIGNED' : '-',
                jobCard.phaseStatuses?.[2] === 'completed' ? 'SIGNED' : '-',
                jobCard.phaseStatuses?.[3] === 'completed' ? 'SIGNED' : '-',
                jobCard.phaseStatuses?.[4] === 'completed' ? 'SIGNED' : '-',
                jobCard.phaseStatuses?.[5] === 'completed' ? 'SIGNED' : '-',
                jobCard.phaseStatuses?.[6] === 'completed' ? 'SIGNED' : '-',
                jobCard.phaseStatuses?.[7] === 'completed' ? 'SIGNED' : '-',
                jobCard.phaseStatuses?.[8] === 'completed' ? 'SIGNED' : '-'
            ]
        ],
        theme: 'grid',
        styles: { fontSize: 8, halign: 'center', cellPadding: 3, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.1 },
        headStyles: { textColor: [0, 0, 0], fontStyle: 'bold' }
    })

    // Handle Output Mode
    if (mode === 'blob') {
        return doc.output('blob')
    } else if (mode === 'datauristring') {
        return doc.output('datauristring')
    } else {
        // Default: save/download the PDF
        doc.save(`JobCard_${jobCard.jobCardNo}.pdf`)
    }
}
