<?php

if ( !defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}

//
// Metabox of the PAGE
// Set a unique slug-like ID
//
$teammeta = 'restly_teammeta';

//
// Create a metabox
//
CSF::createMetabox( $teammeta, array(
    'title'        => esc_html__( 'Team Options', 'restly' ),
    'post_type'    => array( 'restly_team' ),
    'show_restore' => true,
) );

//
// Create a section
//
CSF::createSection( $teammeta, array(
    'title'  => esc_html__( 'Team Sub Title', 'restly' ),
    'icon'   => 'fas fa-rocket',
    'fields' => array(
        array(
            'id'       => 'restly_team_stitle',
            'type'     => 'text',
            'title'    => esc_html__( 'Designation', 'restly' ),
            'subtitle' => esc_html__( 'Add Team Designation here', 'restly' ),
            'default'  => esc_html__( 'Software Engineer', 'restly' ),
        ),
    ),
) );