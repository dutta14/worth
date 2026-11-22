import { FC } from 'react'
import { Link } from 'react-router-dom'
import type { AnnualReview } from '../types'
import { describeNote, describeNoteCount } from '../utils/noteText'

interface ReviewNotesProps {
  review: AnnualReview
}

const ReviewNotes: FC<ReviewNotesProps> = ({ review }) => {
  if (review.notes.length === 0) return null
  return (
    <>
      <p className="sr-only">{describeNoteCount(review.notes.length)}</p>
      <section className="ar-section ar-section--notes" aria-labelledby="ar-notes-h">
        <h3 id="ar-notes-h" className="ar-section__title">
          Things to know
        </h3>
        <ul className="ar-notes">
          {review.notes.map((note, i) => {
            const { text, link } = describeNote(note, review)
            return (
              <li key={`${note.code}-${i}`} className="ar-note">
                <svg
                  className="ar-note__icon"
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>
                  {text}
                  {link && (
                    <>
                      {' '}
                      <Link className="ar-link ar-note__link" to={link.to}>
                        {link.label}
                      </Link>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

export default ReviewNotes
